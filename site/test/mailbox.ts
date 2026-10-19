/**
 * Outbound mail, as the mail service would accept it, for the tests: the site posts to it in place
 * of the real service, and a test reads back what was sent from GET /test/mails.
 */
import { createServer } from "node:http";

export async function startMailbox(port: number) {
  const mails: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const send = (code: number, v: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(v));
    };
    if (req.method === "POST" && req.url === "/emails") {
      mails.push(JSON.parse(body));
      return send(200, { id: `mail_${mails.length}` });
    }
    if (req.method === "GET" && req.url === "/test/mails") return send(200, mails);
    send(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    mails,
    /** The site's settings for sending mail here. */
    env: () => ({ RESEND_API_KEY: "re_test_mailbox", MAIL_FROM: "Structured Note <no-reply@example.org>", RESEND_API_URL: `${url}/emails` }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
