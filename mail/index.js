// Starts the IMAPS / POP3S / SMTPS login-routing listeners configured in [MAIL].
import tls from "tls";
import fs from "fs";
import { handleConnection, makeContext, resolvePath } from "./common.js";
import { imapSession } from "./imap.js";
import { pop3Session } from "./pop3.js";
import { smtpSession } from "./smtp.js";

export const mailStatus = { enabled: false, listeners: [], startedAt: null };

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
  if (ctx.cache) process.once("exit", () => { try { ctx.cache.close(); } catch { /* ignore */ } });

  const tlsOpts = {
    key: fs.readFileSync(resolvePath(deps.baseDir, m.tlsKeyFile)),
    cert: fs.readFileSync(resolvePath(deps.baseDir, m.tlsCertFile)),
    minVersion: "TLSv1.2",
    // A stalled handshake must not hold a connection slot forever; the per
    // connection limits below only start counting once TLS is up.
    handshakeTimeout: Math.max(1, m.handshakeTimeoutSec) * 1000,
  };

  const defs = [
    ["imaps", m.imapsPort, imapSession],
    ["pop3s", m.pop3sPort, pop3Session],
    ["smtps", m.smtpsPort, smtpSession],
  ];
  for (const [name, port, handler] of defs) {
    if (!port) continue;
    const st = { name, port, listening: false, error: "", tlsErrors: 0 };
    mailStatus.listeners.push(st);
    const srv = tls.createServer(tlsOpts, (sock) => handleConnection(sock, handler, ctx));
    if (m.maxConnTotal > 0) srv.maxConnections = m.maxConnTotal;
    // A client that rejects our certificate never sends a login, so without this the
    // failure leaves no trace anywhere.
    srv.on("tlsClientError", (err) => {
      st.tlsErrors = (st.tlsErrors || 0) + 1;
      const msg = String(err?.message || err).slice(0, 160);
      console.error(`[mail] ${name} :${port} tls client error: ${msg}`);
      if (typeof ctx.log === "function") ctx.log({ scope: "mail", proto: name, result: "fail", reason: "tls_client_error", error: msg });
    });
    srv.on("error", (e) => { st.error = e.message; console.error(`[mail] ${name} :${port} error: ${e.message}`); });
    srv.listen(port, m.bindHost, () => {
      st.listening = true;
      console.log(`[mail] ${name} listening on ${m.bindHost}:${port}`);
    });
  }
  mailStatus.startedAt = new Date().toISOString();
  mailStatus.limits = {
    max_conn_per_ip: m.maxConnPerIp,
    max_conn_total: m.maxConnTotal,
    prelogin_timeout_sec: m.preloginTimeoutSec,
    idle_timeout_sec: m.idleTimeoutSec,
    backend_timeout_sec: m.backendTimeoutSec,
    handshake_timeout_sec: m.handshakeTimeoutSec,
    auth_fail_per_ip: m.authFailPerIp,
    auth_fail_per_user: m.authFailPerUser,
    auth_fail_window_sec: m.authFailWindowSec,
    send_originating_ip: m.sendOriginatingIp,
  };
  mailStatus.hostname = m.hostname;
  mailStatus.connections = () => ctx.conns.total;
  mailStatus.cache = () => (ctx.cache ? ctx.cache.stats() : null);
  return ctx;
}
