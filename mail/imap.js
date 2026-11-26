// IMAP pre-login front end: serves CAPABILITY/ID/NOOP until LOGIN or AUTHENTICATE PLAIN,
// then logs in to the chosen backend and splices the two connections.
import { LineReader, ProtoError, decodePlain, routeLogin, splice } from "./common.js";

export const IMAP_CAPS = "IMAP4rev1 LITERAL+ SASL-IR ID AUTH=PLAIN";
const TAG_RE = /^[^\s(){%*"\\+\]]{1,64}$/;
const MAX_LOGIN_FAILS = 3;
const MAX_BAD = 10;

/** Read `count` IMAP astrings (atom, quoted string or literal) starting at `rest`. */
export async function readAstrings(rest, count, reader, client, maxLen = 8192) {
  const out = [];
  let s = rest;
  for (let k = 0; k < count; k++) {
    s = s.replace(/^ +/, "");
    if (s.startsWith('"')) {
      let v = "";
      let i = 1;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === "\\") {
          const n = s[i + 1];
          if (n !== "\\" && n !== '"') throw new ProtoError("Invalid quoted string");
          v += n;
          i++;
        } else if (c === '"') break;
        else v += c;
      }
      if (i >= s.length) throw new ProtoError("Unterminated quoted string");
      out.push(v);
      s = s.slice(i + 1);
    } else {
      const lit = s.match(/^\{(\d{1,6})(\+?)\}$/);
      if (lit) {
        const n = Number(lit[1]);
        if (n > maxLen) throw new ProtoError("Literal too large");
        if (!lit[2]) client.write("+ Ready for literal data\r\n");
        out.push((await reader.readBytes(n)).toString("utf8"));
        s = await reader.readLine();
      } else {
        const atom = s.match(/^[^\s(){%*"\\\]]+/);
        if (!atom) throw new ProtoError("Invalid arguments");
        out.push(atom[0]);
        s = s.slice(atom[0].length);
      }
    }
  }
  if (s.trim() !== "") throw new ProtoError("Too many arguments");
  return out;
}

function quote(v) {
  return `"${v.replace(/[\\"]/g, (m) => "\\" + m)}"`;
}

async function readTagged(br, tag) {
  const untagged = [];
  for (;;) {
    const line = await br.readLine();
    if (line.startsWith(tag + " ")) return { untagged, tagged: line.slice(tag.length + 1) };
    if (line.startsWith("* ")) {
      if (untagged.length > 50) throw new Error("backend too chatty");
      untagged.push(line);
    } else if (line.startsWith("+")) {
      return { untagged, cont: true };
    }
  }
}

/** Log in to an IMAP backend. Returns { ok, reader, reply }. */
export async function imapBackendLogin(sock, email, pass, ip, ctx) {
  const br = new LineReader(sock, { maxLine: 65536 });
  sock.setTimeout(ctx.backendMs, () => sock.destroy());
  const greeting = await br.readLine();
  if (!/^\* OK\b/i.test(greeting)) throw new Error("unexpected IMAP greeting");

  if (ctx.sendOriginatingIp && /^[0-9A-Fa-f:.]+$/.test(ip)) {
    sock.write(`M0 ID ("X-ORIGINATING-IP" "${ip}" "name" "MaM-Portal")\r\n`);
    await readTagged(br, "M0");
  }

  if (/^[\x20-\x7e]*$/.test(pass)) {
    sock.write(`M1 LOGIN ${quote(email)} ${quote(pass)}\r\n`);
  } else {
    const bytes = Buffer.from(pass, "utf8");
    sock.write(`M1 LOGIN ${quote(email)} {${bytes.length}}\r\n`);
    const r = await readTagged(br, "M1");
    if (!r.cont) return { ok: false, reader: br, reply: r };
    sock.write(Buffer.concat([bytes, Buffer.from("\r\n")]));
  }
  const r = await readTagged(br, "M1");
  if (r.cont) throw new Error("unexpected continuation");
  return { ok: /^OK\b/i.test(r.tagged), reader: br, reply: r };
}

export async function imapSession(client, ip, ctx) {
  const r = new LineReader(client, { maxLine: ctx.maxLine });
  const w = (s) => client.write(s + "\r\n");
  w(`* OK [CAPABILITY ${IMAP_CAPS}] ${ctx.hostname} IMAP4rev1 ready`);
  let bad = 0;
  let fails = 0;

  const tryLogin = async (tag, user, pass) => {
    const res = await routeLogin({
      ctx, proto: "imap", ip, user, password: pass,
      login: (sock, _s, email) => imapBackendLogin(sock, email, pass, ip, ctx),
    });
    if (!res) {
      w(`${tag} NO [AUTHENTICATIONFAILED] Authentication failed`);
      return false;
    }
    for (const u of res.reply.untagged) if (/^\* CAPABILITY /i.test(u)) w(u);
    w(`${tag} ${res.reply.tagged}`);
    splice(ctx, client, r, res.sock, res.reader);
    return true;
  };

  for (;;) {
    const line = await r.readLine();
    const m = line.match(/^(\S+) +(\S+)(?: (.*))?$/);
    if (!m || !TAG_RE.test(m[1])) {
      w("* BAD Invalid command");
      if (++bad > MAX_BAD) return client.end();
      continue;
    }
    const [, tag, cmdRaw, rest = ""] = m;
    let creds = null;
    switch (cmdRaw.toUpperCase()) {
      case "CAPABILITY":
        w(`* CAPABILITY ${IMAP_CAPS}`);
        w(`${tag} OK CAPABILITY completed`);
        break;
      case "NOOP":
        w(`${tag} OK NOOP completed`);
        break;
      case "ID":
        w("* ID NIL");
        w(`${tag} OK ID completed`);
        break;
      case "LOGOUT":
        w(`* BYE ${ctx.hostname} logging out`);
        w(`${tag} OK LOGOUT completed`);
        return client.end();
      case "STARTTLS":
        w(`${tag} BAD Already using TLS`);
        break;
      case "LOGIN":
        try {
          const [user, pass] = await readAstrings(rest, 2, r, client, ctx.maxLine);
          creds = { user, pass };
        } catch (e) {
          if (!(e instanceof ProtoError) || /closed/.test(e.message)) throw e;
          w(`${tag} BAD ${e.message}`);
        }
        break;
      case "AUTHENTICATE": {
        const [mech = "", ir] = rest.split(" ");
        if (mech.toUpperCase() !== "PLAIN") { w(`${tag} NO [CANNOT] Unsupported mechanism`); break; }
        let resp = ir;
        if (resp === undefined) {
          client.write("+ \r\n");
          resp = await r.readLine();
        }
        if (resp === "*") { w(`${tag} BAD Authentication cancelled`); break; }
        const c = decodePlain(resp === "=" ? "" : resp);
        if (!c) { w(`${tag} BAD Invalid SASL response`); break; }
        creds = c;
        break;
      }
      default:
        w(`${tag} BAD Command not allowed before login`);
        if (++bad > MAX_BAD) return client.end();
    }
    if (creds) {
      if (await tryLogin(tag, creds.user, creds.pass)) return;
      if (++fails >= MAX_LOGIN_FAILS) {
        w("* BYE Too many authentication failures");
        return client.end();
      }
    }
  }
}
