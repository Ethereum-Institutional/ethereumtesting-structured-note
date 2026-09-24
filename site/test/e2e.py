"""End-to-end check of the access flow against a running development server.

Drives the forms exactly as a browser with JavaScript disabled would, and reads emailed links
from the development mail log. Start the server first:

    OPERATOR_EMAILS=operator@example.org AUTO_APPROVE_DOMAINS=approved.example npx next dev -p 3020 > /tmp/site-dev.log 2>&1 &
    python3 test/e2e.py /tmp/site-dev.log

Uses a fresh .data store; delete site/.data before running.
"""

import http.cookiejar
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from html import unescape

BASE = "http://127.0.0.1:3020"
LOG = sys.argv[1] if len(sys.argv) > 1 else "/tmp/site-dev.log"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.follow = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.nofollow = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect)

    def get(self, path, follow=True):
        try:
            r = (self.follow if follow else self.nofollow).open(BASE + path)
            return r.status, r.read().decode(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), e.headers

    def submit(self, path, form_html, values):
        """Posts one server-action form with its hidden fields plus `values`, as multipart."""
        fields = {}
        for tag in re.findall(r"<input[^>]*>", form_html):
            name = re.search(r'name="([^"]+)"', tag)
            value = re.search(r'value="([^"]*)"', tag)
            if name:
                fields[unescape(name.group(1))] = unescape(value.group(1)) if value else ""
        fields.update(values)
        boundary = uuid.uuid4().hex
        body = "".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields.items())
        body += f"--{boundary}--\r\n"
        req = urllib.request.Request(
            BASE + path,
            data=body.encode(),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "Origin": BASE},
        )
        try:
            r = self.follow.open(req)
            return r.status, r.read().decode(), r.geturl()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), None


def forms(html):
    return re.findall(r"<form.*?</form>", html, flags=re.S)


def form_with(html, marker):
    return next(f for f in forms(html) if marker in f)


def row_for(html, email):
    return next(t for t in re.findall(r"<tr>.*?</tr>", html, flags=re.S) if email in t)


def links_for(email, after):
    time.sleep(1.0)
    text = open(LOG).read()[after:]
    blocks = re.findall(r"\[mail, development only\] to (\S+)\nsubject: ([^\n]+)\n\n(.*?)(?=\n\[mail|\Z)", text, flags=re.S)
    return [re.search(r"(/access\?token=[\w-]+)", b).group(1) for to, _, b in blocks if to == email and "/access?token=" in b]


def log_size():
    return len(open(LOG).read())


checks = 0


def check(cond, what):
    global checks
    checks += 1
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        sys.exit(1)


def register(c, email, name="A. Reader", org="An Institution"):
    _, home, _ = c.get("/")
    return c.submit("/", form_with(home, 'name="organisation"'), {"name": name, "organisation": org, "email": email})


def sign_in_request(c, email):
    _, home, _ = c.get("/")
    return c.submit("/", form_with(home, "Send sign-in link"), {"email": email})


def open_and_confirm(c, link):
    status, page, _ = c.get(link)
    if "Link not valid" in page:
        return status, page, None
    return c.submit(link, form_with(page, 'name="token"'), {"token": re.search(r"token=([\w-]+)", link).group(1)})


# 1. Nothing is visible without access
anon = Client()
check("Register" in anon.get("/")[1] and "INTEGRATION LAYER" not in anon.get("/")[1], "anonymous visitor sees only the registration page")
s, _, h = anon.get("/overview", follow=False)
check(s in (303, 307) and h.get("Location", "").rstrip("/").endswith(("3020", "")), "overview redirects an anonymous visitor")
check(anon.get("/operator")[0] == 404, "operator page is not found for an anonymous visitor")

# 2. Register, confirm, wait for approval
reader = Client()
mark = log_size()
_, page, _ = register(reader, "reader@example.org")
check("If the address can be used" in page, "registration returns the neutral response")
links = links_for("reader@example.org", mark)
check(len(links) == 1, "one confirmation link is sent")
link = links[0]

s, page, _ = reader.get(link)
check("Continue" in page, "opening the link shows a confirmation step")
s, page, _ = reader.get(link)
check("Continue" in page, "opening the link again still works: a prefetch cannot consume it")

_, page, url = open_and_confirm(reader, link)
check(url and url.endswith("/pending"), "confirmation of a new registration lands on pending")
check("INTEGRATION LAYER" not in reader.get("/")[1], "pending registrant still cannot see the architecture")
check("Link not valid" in reader.get(link)[1], "a used link is refused")

# 3. Throttle and enumeration
mark = log_size()
sign_in_request(reader, "reader@example.org")
check(links_for("reader@example.org", mark) == [], "a second link within the interval is throttled, silently")
mark = log_size()
_, page, _ = sign_in_request(anon, "nobody@example.org")
check("If the address can be used" in page and links_for("nobody@example.org", mark) == [], "unknown address: same response, no mail")

# 4. Operator signs in (auto-approved by the operator list) and approves
op = Client()
mark = log_size()
register(op, "operator@example.org", "An Operator", "Operations")
_, _, url = open_and_confirm(op, links_for("operator@example.org", mark)[0])
check(url and url.rstrip("/").endswith("3020"), "operator is approved on confirmation and signed in")
_, ops, _ = op.get("/operator")
check("reader@example.org" in ops and "pending" in ops, "operator sees the pending registration")
row = form_with(row_for(ops, "reader@example.org"), 'value="approve"')
mark = log_size()
op.submit("/operator", row, {})
check("approved" in op.get("/operator")[1], "operator approves")
check("Access approved" in open(LOG).read()[mark:], "the registrant is told by email")

# 5. Approved registrant signs in and reaches the documents
time.sleep(61)  # past the link interval
mark = log_size()
sign_in_request(reader, "reader@example.org")
_, _, url = open_and_confirm(reader, links_for("reader@example.org", mark)[0])
_, home, _ = reader.get("/")
check("INTEGRATION LAYER" in home and 'href="/overview#identity"' in home, "approved registrant sees the linked architecture")
s, ov, h = reader.get("/overview")
check(s == 200 and "Structured Note" in ov and "private, no-store" in h.get("Cache-Control", ""), "overview is served, uncached")
check(reader.get("/operator")[0] == 404, "a non-operator cannot reach the operator page")
check('class="sitebar"' in ov and 'href="/"' in ov and 'action="/signout"' in ov, "the overview carries the site bar")
check('href="/operator"' not in ov, "the overview's bar shows no operator link to a non-operator")
_, ov_op, _ = op.get("/overview")
check('href="/operator"' in ov_op, "the overview's bar shows the operator link to an operator")

# 6. An operator's form replayed without operator rights does nothing
_, ops, _ = op.get("/operator")
row = form_with(row_for(ops, "reader@example.org"), 'value="revoke"')
anon.submit("/operator", row, {})
reader.submit("/operator", row, {})
check("INTEGRATION LAYER" in reader.get("/")[1], "a replayed operator decision without operator rights has no effect")

# 7. Revocation takes effect immediately
op.submit("/operator", row, {})
check("INTEGRATION LAYER" not in reader.get("/")[1], "revoked registrant loses access at once, same session")
check(reader.get("/overview", follow=False)[0] in (303, 307), "revoked registrant cannot fetch the overview")
mark = log_size()
sign_in_request(reader, "reader@example.org")
check(links_for("reader@example.org", mark) == [], "revoked address is sent no link")

# 7b. Sign out from the overview's bar ends the session
leaver = Client()
mark = log_size()
register(leaver, "leaver@approved.example", "Leaving Reader", "Listed Domain")
open_and_confirm(leaver, links_for("leaver@approved.example", mark)[0])
_, ov_l, _ = leaver.get("/overview")
leaver.submit("/signout", form_with(ov_l, 'action="/signout"'), {})
check(leaver.get("/overview", follow=False)[0] in (303, 307), "sign out from the overview ends the session")

# 8. Domain rule: verified addresses on a listed domain are approved without an operator
auto = Client()
mark = log_size()
register(auto, "someone@approved.example", "Auto Reader", "Listed Domain")
_, _, url = open_and_confirm(auto, links_for("someone@approved.example", mark)[0])
check(url and url.rstrip("/").endswith("3020") and "INTEGRATION LAYER" in auto.get("/")[1], "listed-domain address is approved on verification")
check(auto.get("/operator")[0] == 404, "the domain rule grants reading access, not operator rights")
sub = Client()
mark = log_size()
register(sub, "someone@sub.approved.example", "Sub Reader", "Subdomain")
_, _, url = open_and_confirm(sub, links_for("someone@sub.approved.example", mark)[0])
check(url and url.endswith("/pending"), "a subdomain of a listed domain waits for an operator")

# 9. Operator cannot revoke themselves
_, ops, _ = op.get("/operator")
check('value="revoke"' not in row_for(ops, "operator@example.org"), "no self-revoke control is rendered")

print(f"\n{checks} checks passed")
