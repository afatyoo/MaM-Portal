// SMTPS (465) pre-login front end: EHLO + AUTH PLAIN/LOGIN, then backend AUTH (with XCLIENT
// for the real client IP when the backend allows it) and splice.
import net from "net";
import { LineReader, decodeB64, decodePlain, routeLogin, splice } from "./common.js";

const MAX_LOGIN_FAILS = 3;
const MAX_BAD = 10;

export async function readReply(br) {
  const lines = [];
  for (;;) {
    const line = await br.readLine();
    const m = line.match(/^(\d{3})([ -])(.*)$/);
    if (!m) throw new Error("invalid SMTP reply");
    lines.push(m[3]);
    if (lines.length > 100) throw new Error("SMTP reply too long");
    if (m[2] === " ") return { code: Number(m[1]), lines, text: line };
  }
}

function xclientAddr(ip) {
  return net.isIPv6(ip) ? `IPV6:${ip}` : ip;
}

/** Log in to an SMTP submission backend. Returns { ok, reader, reply }. */
export async function smtpBackendLogin(sock, email, pass, ip, ctx) {
  const br = new LineReader(sock, { maxLine: 65536 });
  sock.setTimeout(ctx.backendMs, () => sock.destroy());
  let rep = await readReply(br);
  if (rep.code !== 220) throw new Error("unexpected SMTP greeting");
  const ehlo = async () => {
    sock.write(`EHLO ${ctx.hostname}\r\n`);
    const e = await readReply(br);
    if (e.code !== 250) throw new Error("EHLO rejected");
    return e.lines.map((l) => l.toUpperCase());
  };
  const caps = await ehlo();
  if (ctx.sendOriginatingIp && net.isIP(ip) && caps.some((c) => c.startsWith("XCLIENT"))) {
    sock.write(`XCLIENT ADDR=${xclientAddr(ip)}\r\n`);
    rep = await readReply(br);
    if (rep.code === 220) await ehlo();
  }
  const ir = Buffer.from(`\0${email}\0${pass}`, "utf8").toString("base64");
  sock.write(`AUTH PLAIN ${ir}\r\n`);
  rep = await readReply(br);
  return { ok: rep.code === 235, reader: br, reply: rep };
}

export async function smtpSession(client, ip, ctx) {
  const r = new LineReader(client, { maxLine: ctx.maxLine });
  const w = (s) => client.write(s + "\r\n");
  w(`220 ${ctx.hostname} ESMTP ready`);
  let greeted = false;
  let bad = 0;
  let fails = 0;

  for (;;) {
    const line = await r.readLine();
    const sp = line.indexOf(" ");
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const arg = sp < 0 ? "" : line.slice(sp + 1).trim();
    let creds = null;
    switch (cmd) {
      case "EHLO":
        if (!arg) { w("501 5.5.4 Syntax: EHLO hostname"); break; }
        greeted = true;
        w(`250-${ctx.hostname}`);
        w("250-AUTH PLAIN LOGIN");
        w("250-8BITMIME");
        w("250 ENHANCEDSTATUSCODES");
        break;
      case "HELO":
        if (!arg) { w("501 5.5.4 Syntax: HELO hostname"); break; }
        greeted = true;
        w(`250 ${ctx.hostname}`);
        break;
      case "NOOP":
      case "RSET":
        w("250 2.0.0 OK");
        break;
      case "QUIT":
        w("221 2.0.0 Bye");
        return client.end();
      case "STARTTLS":
        w("454 4.7.0 Already using TLS");
        break;
      case "MAIL":
      case "RCPT":
      case "DATA":
      case "BDAT":
        w("530 5.7.0 Authentication required");
        break;
      case "AUTH": {
        if (!greeted) { w("503 5.5.1 EHLO first"); break; }
        const [mechRaw = "", ir] = arg.split(" ");
        const mech = mechRaw.toUpperCase();
        if (mech === "PLAIN") {
          let resp = ir;
          if (resp === undefined) { w("334 "); resp = await r.readLine(); }
          if (resp === "*") { w("501 5.7.0 Authentication cancelled"); break; }
          creds = decodePlain(resp === "=" ? "" : resp);
          if (!creds) w("501 5.5.2 Invalid SASL response");
        } else if (mech === "LOGIN") {
          let u = ir;
          if (u === undefined) { w("334 VXNlcm5hbWU6"); u = await r.readLine(); }
          if (u === "*") { w("501 5.7.0 Authentication cancelled"); break; }
          w("334 UGFzc3dvcmQ6");
          const p = await r.readLine();
          if (p === "*") { w("501 5.7.0 Authentication cancelled"); break; }
          const user = decodeB64(u);
          const pass = decodeB64(p);
          if (!user || !pass) { w("501 5.5.2 Invalid SASL response"); break; }
          creds = { user, pass };
        } else {
          w("504 5.5.4 Unsupported mechanism");
        }
        break;
      }
      default:
        w("502 5.5.2 Command not allowed before authentication");
        if (++bad > MAX_BAD) return client.end();
    }
    if (creds) {
      const pass = creds.pass;
      const res = await routeLogin({
        ctx, proto: "smtp", ip, user: creds.user, password: pass,
        login: (sock, _s, email) => smtpBackendLogin(sock, email, pass, ip, ctx),
      });
      if (res) {
        w("235 2.7.0 Authentication successful");
        splice(ctx, client, r, res.sock, res.reader);
        return;
      }
      w("535 5.7.8 Authentication credentials invalid");
      if (++fails >= MAX_LOGIN_FAILS) return client.end();
    }
  }
}
