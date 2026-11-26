// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import net from "net";
import {
  LineReader, FailLimiter, ConnLimiter, decodePlain, makeContext, handleConnection, parseMailSection, cleanHostname,
} from "./common.js";
import { imapSession } from "./imap.js";
import { pop3Session } from "./pop3.js";
import { smtpSession } from "./smtp.js";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

// ---- fake backends -------------------------------------------------------
const USERS = { "alice@a.com": "s3cret", "bob@shared.com": "pw b", "carol@shared.com": "pässwörd" };

function fakeImap(accept, seen) {
  return net.createServer((s) => {
    const r = new LineReader(s);
    s.write("* OK fake ready\r\n");
    (async () => {
      for (;;) {
        const line = await r.readLine();
        seen.push(line);
        const [tag, cmd] = line.split(" ");
        if (cmd === "ID") { s.write(`* ID NIL\r\n${tag} OK ID done\r\n`); continue; }
        if (cmd === "LOGIN") {
          let m = line.match(/^\S+ LOGIN "([^"]*)" "((?:[^"\\]|\\.)*)"$/);
          let user, pass;
          if (m) { user = m[1]; pass = m[2].replace(/\\(.)/g, "$1"); } else {
            m = line.match(/^\S+ LOGIN "([^"]*)" \{(\d+)\}$/);
            user = m[1];
            s.write("+ go\r\n");
            pass = (await r.readBytes(Number(m[2]))).toString("utf8");
            await r.readLine();
          }
          if (accept.includes(user) && USERS[user] === pass) {
            s.write(`* CAPABILITY IMAP4rev1 IDLE\r\n${tag} OK [CAPABILITY IMAP4rev1 IDLE] Logged in\r\n`);
            r.detach();
            s.on("data", (d) => { if (/NOOP/.test(d)) s.write("X1 OK backend noop\r\n"); });
            return;
          }
          s.write(`${tag} NO [AUTHENTICATIONFAILED] bad\r\n`);
        }
      }
    })().catch(() => s.destroy());
  });
}

function fakePop(accept, seen) {
  return net.createServer((s) => {
    const r = new LineReader(s);
    s.write("+OK fake pop\r\n");
    let user;
    (async () => {
      for (;;) {
        const line = await r.readLine();
        seen.push(line);
        if (line.startsWith("XOIP ")) s.write("+OK\r\n");
        else if (line.startsWith("USER ")) { user = line.slice(5); s.write("+OK\r\n"); }
        else if (line.startsWith("PASS ")) {
          if (accept.includes(user) && USERS[user] === line.slice(5)) {
            s.write("+OK maildrop ready\r\n");
            r.detach();
            s.on("data", (d) => { if (/STAT/.test(d)) s.write("+OK 0 0\r\n"); });
            return;
          }
          s.write("-ERR bad\r\n");
        }
      }
    })().catch(() => s.destroy());
  });
}

function fakeSmtp(accept, seen) {
  return net.createServer((s) => {
    const r = new LineReader(s);
    s.write("220 fake smtp\r\n");
    (async () => {
      for (;;) {
        const line = await r.readLine();
        seen.push(line);
        if (line.startsWith("EHLO")) s.write("250-fake\r\n250-XCLIENT ADDR NAME\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("XCLIENT")) s.write("220 fake smtp again\r\n");
        else if (line.startsWith("AUTH PLAIN ")) {
          const [, u, p] = Buffer.from(line.slice(11), "base64").toString("utf8").split("\0");
          if (accept.includes(u) && USERS[u] === p) {
            s.write("235 ok\r\n");
            r.detach();
            s.on("data", (d) => { if (/MAIL FROM/.test(d)) s.write("250 2.1.0 Ok\r\n"); });
            return;
          }
          s.write("535 bad\r\n");
        }
      }
    })().catch(() => s.destroy());
  });
}

// ---- harness ------------------------------------------------------------
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));

function client(port) {
  const s = net.connect(port, "127.0.0.1");
  const r = new LineReader(s, { maxLine: 65536 });
  return {
    s,
    send: (l) => s.write(l + "\r\n"),
    line: () => r.readLine(),
    async until(re) { for (;;) { const l = await this.line(); if (re.test(l)) return l; } },
    close: () => s.destroy(),
  };
}

let servers, logs, seen, ctx;

async function setup(handler, fake) {
  seen = { A: [], B: [] };
  logs = [];
  const backA = fake(["alice@a.com", "bob@shared.com"], seen.A);
  const backB = fake(["carol@shared.com"], seen.B);
  const ports = { MaMKey_1: await listen(backA), MaMKey_2: await listen(backB) };
  const cfg = {
    defaultDomain: "a.com",
    mail: parseMailSection({ MAIL: { enabled: "true", hostname: "mail.test", auth_fail_per_user: "3" } }),
    servers: [
      { key: "MaMKey_1", domains: ["a.com", "shared.com"] },
      { key: "MaMKey_2", domains: ["shared.com"] },
    ],
  };
  ctx = makeContext({
    getConfig: () => cfg,
    findCandidates: (srv, d) => srv.filter((s) => s.domains.includes(d)),
    normalizeEmail: (u, d) => (u.includes("@") ? u : `${u}@${d}`),
    log: (e) => logs.push(e),
    delay: async () => {},
    cacheFile: "",
    connectBackend: (s) => new Promise((res, rej) => {
      const c = net.connect(ports[s.key], "127.0.0.1", () => res(c));
      c.once("error", rej);
    }),
  });
  const front = net.createServer((sock) => handleConnection(sock, handler, ctx));
  servers = [backA, backB, front];
  return listen(front);
}

afterEach(() => { for (const s of servers || []) s.close(); });

// ---- unit tests -----------------------------------------------------------
describe("helpers", () => {
  it("decodePlain parses and rejects impersonation", () => {
    expect(decodePlain(b64("\0u@x.com\0pw"))).toEqual({ user: "u@x.com", pass: "pw" });
    expect(decodePlain(b64("u@x.com\0u@x.com\0pw"))).toEqual({ user: "u@x.com", pass: "pw" });
    expect(decodePlain(b64("admin@x.com\0u@x.com\0pw"))).toBeNull();
    expect(decodePlain("!!!")).toBeNull();
  });
  it("LineReader drops a connection that floods unread data", async () => {
    const srv = net.createServer((s) => { new LineReader(s, { maxLine: 100 }); });
    const port = await listen(srv);
    const c = net.connect(port, "127.0.0.1");
    const closed = new Promise((r) => c.on("close", r));
    c.on("error", () => {});
    c.write("x".repeat(1000));
    await closed;
    srv.close();
  });
  it("FailLimiter uses a sliding window", () => {
    const l = new FailLimiter(2, 1000);
    l.fail("k", 0); l.fail("k", 10);
    expect(l.blocked("k", 20)).toBe(true);
    expect(l.blocked("k", 1500)).toBe(false);
  });
  it("ConnLimiter caps per IP", () => {
    const c = new ConnLimiter(1, 10);
    expect(c.acquire("1.1.1.1")).toBe(true);
    expect(c.acquire("1.1.1.1")).toBe(false);
    c.release("1.1.1.1");
    expect(c.acquire("1.1.1.1")).toBe(true);
  });
  it("FailLimiter keeps its map bounded under a spray of keys", () => {
    const l = new FailLimiter(2, 1000, 5);
    for (let i = 0; i < 100; i++) { l.fail(`u${i}`, 0); l.fail(`u${i}`, 0); }
    expect(l.size).toBe(5);
    expect(l.blocked("u0", 0)).toBe(false);
    expect(l.blocked("u99", 0)).toBe(true);
  });
  it("cleanHostname strips what would break a protocol line", () => {
    expect(cleanHostname("mail.test")).toBe("mail.test");
    expect(cleanHostname("mail.test\r\n250 injected")).toBe("mail.test250injected");
    expect(cleanHostname("has space")).toBe("hasspace");
    expect(cleanHostname("\r\n")).toBe("localhost");
    expect(cleanHostname(undefined)).toBe("localhost");
  });
  it("parseMailSection defaults the new limits and reads overrides", () => {
    const d = parseMailSection({ MAIL: {} });
    expect(d).toMatchObject({
      handshakeTimeoutSec: 30,
      failLimiterMaxKeys: 20000,
      routeCacheEnabled: true,
      routeCacheFile: "data/mail-route-cache.json",
      routeCacheTtlDays: 90,
      routeCacheMaxEntries: 50000,
    });
    const o = parseMailSection({ MAIL: {
      route_cache_enabled: "false", route_cache_ttl_days: "7", handshake_timeout_sec: "5",
    } });
    expect(o).toMatchObject({ routeCacheEnabled: false, routeCacheTtlDays: 7, handshakeTimeoutSec: 5 });
  });
});

// ---- IMAP -----------------------------------------------------------------
describe("IMAP proxy", () => {
  let port;
  beforeEach(async () => { port = await setup(imapSession, fakeImap); });

  it("logs in with LOGIN, sends ID with client IP and splices", async () => {
    const c = client(port);
    expect(await c.line()).toMatch(/^\* OK \[CAPABILITY .*AUTH=PLAIN/);
    c.send("a1 CAPABILITY");
    await c.until(/^a1 OK/);
    c.send('a2 LOGIN alice "s3cret"');
    expect(await c.until(/^a2 /)).toMatch(/^a2 OK \[CAPABILITY IMAP4rev1 IDLE\]/);
    c.send("X1 NOOP");
    expect(await c.line()).toBe("X1 OK backend noop");
    expect(seen.A[0]).toBe('M0 ID ("X-ORIGINATING-IP" "127.0.0.1" "name" "MaM-Portal")');
    expect(logs.at(-1)).toMatchObject({ result: "ok", server_key: "MaMKey_1", email: "alice@a.com", proto: "imap" });
    expect(JSON.stringify(logs)).not.toContain("s3cret");
    c.close();
  });

  it("falls back to the second server and handles literals + non-ASCII passwords", async () => {
    const c = client(port);
    await c.line();
    const pw = Buffer.from("pässwörd", "utf8");
    c.send(`a1 LOGIN carol@shared.com {${pw.length}}`);
    expect(await c.line()).toMatch(/^\+/);
    c.s.write(Buffer.concat([pw, Buffer.from("\r\n")]));
    expect(await c.until(/^a1 /)).toMatch(/^a1 OK/);
    expect(logs.at(-1)).toMatchObject({ result: "ok", server_key: "MaMKey_2", attempted: ["MaMKey_1", "MaMKey_2"] });
    c.close();
  });

  it("supports AUTHENTICATE PLAIN with SASL-IR and quoted passwords with spaces", async () => {
    const c = client(port);
    await c.line();
    c.send(`a1 AUTHENTICATE PLAIN ${b64("\0bob@shared.com\0pw b")}`);
    expect(await c.until(/^a1 /)).toMatch(/^a1 OK/);
    c.close();
  });

  it("rejects wrong passwords, rate-limits the user and never logs the password", async () => {
    for (let i = 0; i < 3; i++) {
      const c = client(port);
      await c.line();
      c.send('a1 LOGIN alice "wrong-pw"');
      expect(await c.until(/^a1 /)).toMatch(/^a1 NO \[AUTHENTICATIONFAILED\]/);
      c.close();
    }
    const c = client(port);
    await c.line();
    c.send('a1 LOGIN alice "s3cret"');
    expect(await c.until(/^a1 /)).toMatch(/^a1 NO/);
    expect(logs.at(-1)).toMatchObject({ reason: "rate_limited" });
    expect(JSON.stringify(logs)).not.toContain("wrong-pw");
    c.close();
  });

  it("refuses commands before login and unmapped domains", async () => {
    const c = client(port);
    await c.line();
    c.send("a1 SELECT INBOX");
    expect(await c.line()).toMatch(/^a1 BAD/);
    c.send('a2 LOGIN x@nowhere.org "pw"');
    expect(await c.until(/^a2 /)).toMatch(/^a2 NO/);
    expect(logs.at(-1)).toMatchObject({ reason: "domain_unmapped" });
    c.close();
  });

  it("uses the routing cache so a shared domain stops retrying the wrong server", async () => {
    const first = client(port);
    await first.line();
    first.send('a1 LOGIN carol@shared.com "pässwörd"');
    expect(await first.until(/^a1 /)).toMatch(/^a1 OK/);
    expect(logs.at(-1)).toMatchObject({ result: "ok", server_key: "MaMKey_2", attempted: ["MaMKey_1", "MaMKey_2"], cache: "miss" });
    first.close();

    const second = client(port);
    await second.line();
    second.send('a2 LOGIN carol@shared.com "pässwörd"');
    expect(await second.until(/^a2 /)).toMatch(/^a2 OK/);
    expect(logs.at(-1)).toMatchObject({ result: "ok", server_key: "MaMKey_2", attempted: ["MaMKey_2"], cache: "hit" });
    expect(ctx.cache.get("carol@shared.com")).toBe("MaMKey_2");
    second.close();
  });

  it("does not cache accounts of a domain that only one server has", async () => {
    const c = client(port);
    await c.line();
    c.send('a1 LOGIN alice "s3cret"');
    expect(await c.until(/^a1 /)).toMatch(/^a1 OK/);
    expect(ctx.cache.map.size).toBe(0);
    c.close();
  });

  it("rejects a tag with a control byte", async () => {
    const c = client(port);
    await c.line();
    c.s.on("error", () => {});
    c.s.write("a\x01x NOOP\r\n");
    expect(await c.line()).toBe("* BAD Invalid command");
    c.close();
  });

  it("hangs up on a connection that squats before login", async () => {
    const c = client(port);
    await c.line();
    c.s.on("error", () => {});
    const closed = new Promise((resolve) => c.s.on("close", resolve));
    for (let i = 0; i < 205; i++) c.send(`a${i} NOOP`);
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("connection not closed")), 5000)),
    ]);
    expect(c.s.destroyed || c.s.readableEnded || c.s.closed).toBe(true);
  });
});

// ---- POP3 -----------------------------------------------------------------
describe("POP3 proxy", () => {
  let port;
  beforeEach(async () => { port = await setup(pop3Session, fakePop); });

  it("USER/PASS with XOIP and splice", async () => {
    const c = client(port);
    expect(await c.line()).toMatch(/^\+OK/);
    c.send("USER alice");
    expect(await c.line()).toBe("+OK");
    c.send("PASS s3cret");
    expect(await c.line()).toBe("+OK maildrop ready");
    c.send("STAT");
    expect(await c.line()).toBe("+OK 0 0");
    expect(seen.A[0]).toBe("XOIP 127.0.0.1");
    expect(seen.A[1]).toBe("USER alice@a.com");
    c.close();
  });

  it("AUTH PLAIN, wrong password and fallback", async () => {
    const c = client(port);
    await c.line();
    c.send("AUTH PLAIN");
    expect(await c.line()).toMatch(/^\+ /);
    c.send(b64("\0carol@shared.com\0nope"));
    expect(await c.line()).toMatch(/^-ERR \[AUTH\]/);
    c.send(`AUTH PLAIN ${b64("\0carol@shared.com\0pässwörd")}`);
    expect(await c.line()).toBe("+OK maildrop ready");
    c.close();
  });

  it("ends a connection that keeps sending PASS without USER", async () => {
    const c = client(port);
    await c.line();
    c.s.on("error", () => {});
    const closed = new Promise((resolve) => c.s.on("close", resolve));
    for (let i = 0; i < 15; i++) c.send("PASS nope");
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("connection not closed")), 5000)),
    ]);
    expect(c.s.destroyed || c.s.readableEnded || c.s.closed).toBe(true);
  });
});

// ---- SMTP -----------------------------------------------------------------
describe("SMTPS proxy", () => {
  let port;
  beforeEach(async () => { port = await setup(smtpSession, fakeSmtp); });

  it("AUTH LOGIN with XCLIENT then splice", async () => {
    const c = client(port);
    expect(await c.line()).toMatch(/^220 /);
    c.send("MAIL FROM:<a@a.com>");
    expect(await c.line()).toMatch(/^530/);
    c.send("EHLO client.example");
    expect(await c.until(/^250 /)).toBe("250 ENHANCEDSTATUSCODES");
    c.send("AUTH LOGIN");
    expect(await c.line()).toBe("334 VXNlcm5hbWU6");
    c.send(b64("alice@a.com"));
    expect(await c.line()).toBe("334 UGFzc3dvcmQ6");
    c.send(b64("s3cret"));
    expect(await c.line()).toMatch(/^235 /);
    c.send("MAIL FROM:<alice@a.com>");
    expect(await c.line()).toBe("250 2.1.0 Ok");
    expect(seen.A).toContain("XCLIENT ADDR=127.0.0.1");
    c.close();
  });

  it("AUTH PLAIN failure returns 535", async () => {
    const c = client(port);
    await c.line();
    c.send("EHLO x");
    await c.until(/^250 /);
    c.send(`AUTH PLAIN ${b64("\0alice@a.com\0bad")}`);
    expect(await c.line()).toMatch(/^535 /);
    c.close();
  });

  it("ends a connection that sprays unsupported commands", async () => {
    const c = client(port);
    await c.line();
    c.s.on("error", () => {});
    const closed = new Promise((resolve) => c.s.on("close", resolve));
    for (let i = 0; i < 15; i++) c.send("VRFY root");
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("connection not closed")), 5000)),
    ]);
    expect(c.s.destroyed || c.s.readableEnded || c.s.closed).toBe(true);
  });
});
