// POP3 pre-login front end: CAPA/USER/PASS/AUTH PLAIN, then backend login and splice.
import { LineReader, decodePlain, routeLogin, splice } from "./common.js";

const MAX_LOGIN_FAILS = 3;
const MAX_BAD = 10;

/** Log in to a POP3 backend. Returns { ok, reader, reply }. */
export async function pop3BackendLogin(sock, email, pass, ip, ctx) {
  const br = new LineReader(sock, { maxLine: 65536 });
  sock.setTimeout(ctx.backendMs, () => sock.destroy());
  const greeting = await br.readLine();
  if (!greeting.startsWith("+OK")) throw new Error("unexpected POP3 greeting");

  if (ctx.sendOriginatingIp && /^[0-9A-Fa-f:.]+$/.test(ip)) {
    sock.write(`XOIP ${ip}\r\n`);
    await br.readLine(); // +OK or -ERR; either way continue
  }
  sock.write(`USER ${email}\r\n`);
  const u = await br.readLine();
  if (!u.startsWith("+OK")) return { ok: false, reader: br, reply: u };
  sock.write(`PASS ${pass}\r\n`);
  const p = await br.readLine();
  return { ok: p.startsWith("+OK"), reader: br, reply: p };
}

export async function pop3Session(client, ip, ctx) {
  const r = new LineReader(client, { maxLine: ctx.maxLine });
  const w = (s) => client.write(s + "\r\n");
  w(`+OK ${ctx.hostname} POP3 ready`);
  let user = null;
  let bad = 0;
  let fails = 0;

  for (;;) {
    const line = await r.readLine();
    const sp = line.indexOf(" ");
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const arg = sp < 0 ? "" : line.slice(sp + 1);
    let creds = null;
    switch (cmd) {
      case "CAPA":
        w("+OK Capability list follows");
        w("USER");
        w("SASL PLAIN");
        w("IMPLEMENTATION MaM-Portal");
        w(".");
        break;
      case "NOOP":
        w("+OK");
        break;
      case "QUIT":
        w(`+OK ${ctx.hostname} signing off`);
        return client.end();
      case "STLS":
        w("-ERR Already using TLS");
        break;
      case "USER":
        if (!arg || /\s/.test(arg)) { w("-ERR Invalid user"); break; }
        user = arg;
        w("+OK");
        break;
      case "PASS":
        if (!user) { w("-ERR USER first"); break; }
        creds = { user, pass: arg };
        user = null;
        break;
      case "AUTH": {
        if (!arg) { w("+OK"); w("PLAIN"); w("."); break; }
        const [mech, ir] = arg.split(" ");
        if (mech.toUpperCase() !== "PLAIN") { w("-ERR Unsupported mechanism"); break; }
        let resp = ir;
        if (resp === undefined) {
          client.write("+ \r\n");
          resp = await r.readLine();
        }
        if (resp === "*") { w("-ERR Authentication cancelled"); break; }
        const c = decodePlain(resp === "=" ? "" : resp);
        if (!c) { w("-ERR Invalid SASL response"); break; }
        creds = c;
        break;
      }
      default:
        w("-ERR Command not allowed before login");
        if (++bad > MAX_BAD) return client.end();
    }
    if (creds) {
      const pass = creds.pass;
      const res = await routeLogin({
        ctx, proto: "pop3", ip, user: creds.user, password: pass,
        login: (sock, _s, email) => pop3BackendLogin(sock, email, pass, ip, ctx),
      });
      if (res) {
        w(res.reply);
        splice(ctx, client, r, res.sock, res.reader);
        return;
      }
      w("-ERR [AUTH] Authentication failed");
      if (++fails >= MAX_LOGIN_FAILS) return client.end();
    }
  }
}
