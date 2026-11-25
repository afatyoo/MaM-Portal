// Starts the IMAPS / POP3S / SMTPS login-routing listeners configured in [MAIL].
import tls from "tls";
import fs from "fs";
import { handleConnection, makeContext, resolvePath } from "./common.js";
import { imapSession } from "./imap.js";
import { pop3Session } from "./pop3.js";
import { smtpSession } from "./smtp.js";

export const mailStatus = { enabled: false, listeners: [] };

/**
 * deps: { getConfig, findCandidates, normalizeEmail, log, baseDir }
 * A failure here is reported but never takes the web portal down.
 */
export function startMailProxy(deps) {
  const cfg = deps.getConfig();
  const m = cfg.mail;
  mailStatus.enabled = !!m?.enabled;
  if (!m?.enabled) return null;

  for (const s of cfg.servers) {
    if (s.insecureTls) console.warn(`[mail] WARNING: ${s.key} uses insecure_tls=true (backend certificate not verified)`);
  }

  const ctx = makeContext(deps);
  setInterval(() => { ctx.ipFail.sweep(); ctx.userFail.sweep(); }, 60_000).unref();

  const tlsOpts = {
    key: fs.readFileSync(resolvePath(deps.baseDir, m.tlsKeyFile)),
    cert: fs.readFileSync(resolvePath(deps.baseDir, m.tlsCertFile)),
    minVersion: "TLSv1.2",
  };

  const defs = [
    ["imaps", m.imapsPort, imapSession],
    ["pop3s", m.pop3sPort, pop3Session],
    ["smtps", m.smtpsPort, smtpSession],
  ];
  for (const [name, port, handler] of defs) {
    if (!port) continue;
    const st = { name, port, listening: false, error: "" };
    mailStatus.listeners.push(st);
    const srv = tls.createServer(tlsOpts, (sock) => handleConnection(sock, handler, ctx));
    srv.on("tlsClientError", () => {});
    srv.on("error", (e) => { st.error = e.message; console.error(`[mail] ${name} :${port} error: ${e.message}`); });
    srv.listen(port, m.bindHost, () => {
      st.listening = true;
      console.log(`[mail] ${name} listening on ${m.bindHost}:${port}`);
    });
  }
  mailStatus.connections = () => ctx.conns.total;
  return ctx;
}
