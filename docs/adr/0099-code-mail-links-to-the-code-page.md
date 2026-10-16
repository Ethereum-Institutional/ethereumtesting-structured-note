# 0099. The code mail links to the page that takes the code

- **Status:** Accepted
- **Date:** 16 October 2026

## Context

Sign-in is by a six-digit code sent by email (ADR 0093). The code is typed into the page it was
asked from. If that tab has been closed, or the mail is read later or elsewhere, the visitor has to
start again from the home page, where asking for another code is throttled for a minute.

## Decision

Every code mail also carries a link, `<site>/access?email=<address>`. It opens a page holding the
code box for that address, so the code can be typed there, in a new tab or later.

| Option | Outcome |
|---|---|
| The link opens the code page; the code is still typed | **Chosen by the owner.** Sign-in stays code-only, as ADR 0093 set it |
| The link carries the code, and one click on the page signs in | Not chosen. The code would sit in the URL and in browser history, and anyone holding the mail or the link could sign in |

**What the link carries.** The address only, never the code, so the link alone signs no one in.

**What the page reveals.** Nothing about whether the address is registered. A code typed there for
an unknown address is refused in the same words as a wrong one. Without a valid address in the
link, the page sends the visitor to ask for a code.

## Consequences

**The mail's text.** "Type it into the page you asked from, or open this page and type it there",
followed by the link. The code's lifetime and attempt limits are unchanged.

**Privacy.** The address appears in the URL, so it is kept in the visitor's browser history. The
site sends no referrer (`Referrer-Policy: no-referrer`), so the address does not leave the site in
a Referer header.

**Tests.** Browser spec 00 asks for a code and reads the link from the mail. It checks the link
does not carry the code, opens it in a fresh browser, types the code, and is signed in.
