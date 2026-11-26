// Shared building blocks for the IMAPS / POP3S / SMTPS login-routing proxy.
// Credentials are only held in memory for the duration of a login and are never logged.
import tls from "tls";
import net from "net";
import fs from "fs";
import path from "path";
import { RouteCache } from "./route-cache.js";

export class ProtoError extends Error {}

/**
 * Hard cap on commands a connection may send before it is authenticated. Without it
 * a client can keep a pre-login slot forever: every command resets the pre-login
 * timeout, and commands that fail to parse never touched the bad-command counter.
 */
export const MAX_PRELOGIN_COMMANDS = 200;

export const EMAIL_RE = /^[A-Za-z0-9._%+\-=']{1,128}@[A-Za-z0-9.-]{1,253}$/;

/** Buffered line/byte reader over a socket, used only before login. */
export class LineReader {
  constructor(sock, { maxLine = 8192 } = {}) {
    this.sock = sock;
    this.maxLine = maxLine;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.waiter = null;
    this.maxBuffer = maxLine * 4;
    this.onData = (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      // Unread data piling up (e.g. a client flooding while we wait on a backend): drop the connection.
      if (this.buf.length > this.maxBuffer) { this.closed = true; sock.destroy(); }
      this._wake();
    };
    this.onEnd = () => { this.closed = true; this._wake(); };
    sock.on("data", this.onData);
    sock.on("end", this.onEnd);
    sock.on("close", this.onEnd);
    sock.on("error", this.onEnd);
  }

  _wake() { const w = this.waiter; this.waiter = null; if (w) w(); }

  async _wait() {
    if (this.closed) throw new ProtoError("connection closed");
    await new Promise((r) => { this.waiter = r; });
  }

  async readLine() {
    for (;;) {
      const i = this.buf.indexOf(10);
      if (i >= 0) {
        if (i > this.maxLine) throw new ProtoError("line too long");
        const line = this.buf.subarray(0, i).toString("utf8").replace(/\r$/, "");
        this.buf = this.buf.subarray(i + 1);
        return line;
      }
      if (this.buf.length > this.maxLine) throw new ProtoError("line too long");
      await this._wait();
    }
  }

  async readBytes(n) {
    while (this.buf.length < n) await this._wait();
    const b = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return b;
  }

  /** Stop reading and hand back whatever was buffered but not consumed. */
  detach() {
    this.sock.off("data", this.onData);
    this.sock.off("end", this.onEnd);
    this.sock.off("close", this.onEnd);
    this.sock.off("error", this.onEnd);
    const rest = this.buf;
    this.buf = Buffer.alloc(0);
    return rest;
  }
}

export function cleanIp(a) {
  return String(a || "").replace(/^::ffff:/i, "");
}

/**
 * Sliding-window failure counter (per IP or per user). `maxKeys` keeps a spray of
 * random addresses or usernames from growing the map without bound.
 */
export class FailLimiter {
  constructor(limit, windowMs, maxKeys = 0) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys > 0 ? maxKeys : 0;
    this.m = new Map();
  }
  _get(key, now) {
    const a = (this.m.get(key) || []).filter((t) => now - t < this.windowMs);
    if (a.length) this.m.set(key, a); else this.m.delete(key);
    return a;
  }
  _evict() {
    while (this.maxKeys && this.m.size > this.maxKeys) this.m.delete(this.m.keys().next().value);
  }
  blocked(key, now = Date.now()) { return this.limit > 0 && this._get(key, now).length >= this.limit; }
  fail(key, now = Date.now()) { const a = this._get(key, now); a.push(now); this.m.set(key, a); this._evict(); }
  reset(key) { this.m.delete(key); }
  sweep(now = Date.now()) { for (const k of [...this.m.keys()]) this._get(k, now); }
  get size() { return this.m.size; }
}

/** Concurrent connection limits (per IP and total). */
export class ConnLimiter {
  constructor(perIp, maxTotal) { this.perIp = perIp; this.maxTotal = maxTotal; this.m = new Map(); this.total = 0; }
  acquire(ip) {
    const n = this.m.get(ip) || 0;
    if ((this.maxTotal > 0 && this.total >= this.maxTotal) || (this.perIp > 0 && n >= this.perIp)) return false;
    this.m.set(ip, n + 1);
    this.total++;
    return true;
  }
  release(ip) {
    const n = (this.m.get(ip) || 1) - 1;
    if (n <= 0) this.m.delete(ip); else this.m.set(ip, n);
    this.total = Math.max(0, this.total - 1);
  }
}

const toBool = (v, d = false) => (v === undefined || v === null || v === "" ? d : String(v).toLowerCase() === "true");
const toNum = (v, d) => {
  if (v === undefined || v === null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * The hostname shows up in greetings and in EHLO to a backend, so it has to be a
 * plain protocol token: no control characters, no spaces.
 */
export function cleanHostname(v, fallback = "localhost") {
  const s = String(v ?? "").replace(/[^\x21-\x7e]/g, "").slice(0, 253);
  return s || fallback;
}

/** Parse the [MAIL] section of config.ini. */
export function parseMailSection(cfg) {
  const m = (cfg && cfg.MAIL) || {};
  return {
    enabled: toBool(m.enabled),
    bindHost: String(m.bind_host || "0.0.0.0").trim(),
    hostname: cleanHostname(m.hostname),
    imapsPort: toNum(m.imaps_port, 993),
    pop3sPort: toNum(m.pop3s_port, 995),
    smtpsPort: toNum(m.smtps_port, 465),
    tlsCertFile: String(m.tls_cert_file || "certs/mail.crt").trim(),
    tlsKeyFile: String(m.tls_key_file || "certs/mail.key").trim(),
    sendOriginatingIp: toBool(m.send_originating_ip, true),
    maxConnPerIp: toNum(m.max_conn_per_ip, 20),
    maxConnTotal: toNum(m.max_conn_total, 2000),
    preloginTimeoutSec: toNum(m.prelogin_timeout_sec, 60),
    idleTimeoutSec: toNum(m.idle_timeout_sec, 35 * 60),
    backendTimeoutSec: toNum(m.backend_timeout_sec, 15),
    handshakeTimeoutSec: toNum(m.handshake_timeout_sec, 30),
    authFailPerIp: toNum(m.auth_fail_per_ip, 10),
    authFailPerUser: toNum(m.auth_fail_per_user, 5),
    authFailWindowSec: toNum(m.auth_fail_window_sec, 600),
    failLimiterMaxKeys: toNum(m.fail_limiter_max_keys, 20000),
    routeCacheEnabled: toBool(m.route_cache_enabled, true),
    routeCacheFile: String(m.route_cache_file || "data/mail-route-cache.json").trim(),
    routeCacheTtlDays: toNum(m.route_cache_ttl_days, 90),
    routeCacheMaxEntries: toNum(m.route_cache_max_entries, 50000),
  };
}

/** Per-backend mail settings from a [MaMKey_N] section. */
export function parseServerMail(s, serverUrl) {
  let urlHost = "";
  try { urlHost = new URL(serverUrl).hostname; } catch { /* ignore */ }
  const host = String(s.mail_host || urlHost).trim();
  return {
    host,
    servername: String(s.mail_servername || host).trim(),
    imapPort: toNum(s.imap_port, 993),
    pop3Port: toNum(s.pop3_port, 995),
    smtpPort: toNum(s.smtps_port, 465),
  };
}

export function resolvePath(baseDir, p) {
  return path.isAbsolute(p) ? p : path.join(baseDir, p);
}

/** Open a verified TLS connection to a backend. */
export function connectTls({ host, port, servername, caFile, insecureTls, baseDir, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const opts = { host, port, minVersion: "TLSv1.2", rejectUnauthorized: !insecureTls };
    if (servername && !net.isIP(servername)) opts.servername = servername;
    if (servername) opts.checkServerIdentity = (_h, cert) => tls.checkServerIdentity(servername, cert);
    if (caFile) opts.ca = fs.readFileSync(resolvePath(baseDir, caFile));
    const s = tls.connect(opts);
    const t = setTimeout(() => { s.destroy(); reject(new Error("backend connect timeout")); }, timeoutMs);
    s.once("secureConnect", () => { clearTimeout(t); resolve(s); });
    s.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}

/** Decode a SASL PLAIN response. Rejects proxy-authorization as someone else. */
export function decodePlain(b64) {
  const s = String(b64 || "").trim();
  if (s.length > 4096 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const parts = Buffer.from(s, "base64").toString("utf8").split("\0");
  if (parts.length !== 3) return null;
  const [authz, user, pass] = parts;
  if (!user || !pass) return null;
  if (authz && authz !== user) return null;
  return { user, pass };
}

export function decodeB64(s) {
  const t = String(s || "").trim();
  if (t.length > 4096 || !/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return null;
  return Buffer.from(t, "base64").toString("utf8");
}

const randomDelay = () => new Promise((r) => setTimeout(r, 1000 + Math.floor(Math.random() * 2000)));

/**
 * Shared runtime state for all listeners.
 * deps: { getConfig, findCandidates, normalizeEmail, log, baseDir, connectBackend?, delay? }
 */
export function makeContext(deps) {
  const m = deps.getConfig().mail;
  const windowMs = m.authFailWindowSec * 1000;
  const ctx = {
    ...deps,
    hostname: m.hostname,
    sendOriginatingIp: m.sendOriginatingIp,
    preloginMs: m.preloginTimeoutSec * 1000,
    idleMs: m.idleTimeoutSec * 1000,
    backendMs: m.backendTimeoutSec * 1000,
    maxLine: 8192,
    conns: new ConnLimiter(m.maxConnPerIp, m.maxConnTotal),
    ipFail: new FailLimiter(m.authFailPerIp, windowMs, m.failLimiterMaxKeys),
    userFail: new FailLimiter(m.authFailPerUser, windowMs, m.failLimiterMaxKeys),
    delay: deps.delay || randomDelay,
  };
  if (m.routeCacheEnabled) {
    ctx.cache = deps.cache || new RouteCache({
      file: deps.cacheFile !== undefined ? deps.cacheFile : resolvePath(deps.baseDir || ".", m.routeCacheFile),
      ttlMs: m.routeCacheTtlDays > 0 ? m.routeCacheTtlDays * 86400000 : 0,
      maxEntries: m.routeCacheMaxEntries,
      log: deps.log,
    });
  } else {
    ctx.cache = null;
  }
  ctx.connectBackend = deps.connectBackend || ((s, proto) => connectTls({
    host: s.mail.host,
    servername: s.mail.servername,
    port: { imap: s.mail.imapPort, pop3: s.mail.pop3Port, smtp: s.mail.smtpPort }[proto],
    caFile: s.caFile,
    insecureTls: s.insecureTls,
    baseDir: deps.baseDir,
    timeoutMs: ctx.backendMs,
  }));
  return ctx;
}

/**
 * Pick backends for a user and try `login(sock, server, email)` on each in order.
 * Returns { sock, reader, server, reply } on success, or null.
 */
export async function routeLogin({ ctx, proto, ip, user, password, login }) {
  const started = Date.now();
  const cfg = ctx.getConfig();
  const email = String(ctx.normalizeEmail(user, cfg.defaultDomain) || "").toLowerCase();
  const domain = email.split("@")[1] || "";
  const base = { timestamp: new Date().toISOString(), method: proto, proto, ip, email, domain };
  const record = (result, extra) => ctx.log({ ...base, ...extra, result, ms: Date.now() - started });
  const reject = async (reason, extra = {}, count = true) => {
    if (count) {
      ctx.ipFail.fail(ip);
      if (email) ctx.userFail.fail(email);
    }
    await ctx.delay();
    record("fail", { server_key: "", ...extra, reason });
    return null;
  };

  if (ctx.ipFail.blocked(ip) || (email && ctx.userFail.blocked(email))) return reject("rate_limited", {}, false);
  if (!EMAIL_RE.test(email) || !password || /[\r\n\0]/.test(password)) return reject("invalid_credentials");

  const candidates = ctx.findCandidates(cfg.servers, domain);
  if (!candidates.length) return reject("domain_unmapped");

  // A domain on several servers is the slow case, so try the server that accepted
  // this address last first. A stale entry only costs one extra attempt, and the
  // new answer is cached right after a successful login.
  const cached = ctx.cache && candidates.length > 1 ? ctx.cache.get(email) : null;
  const ordered = cached
    ? [...candidates.filter((s) => s.key === cached), ...candidates.filter((s) => s.key !== cached)]
    : candidates;

  const attempted = [];
  let rejectedByBackend = false;
  for (const s of ordered) {
    attempted.push(s.key);
    let sock;
    try {
      sock = await ctx.connectBackend(s, proto);
    } catch (e) {
      record("fail", { server_key: s.key, reason: "backend_error", error: String(e?.message || e).slice(0, 200) });
      continue;
    }
    try {
      const r = await login(sock, s, email);
      if (r.ok) {
        ctx.userFail.reset(email);
        if (ctx.cache && candidates.length > 1) ctx.cache.set(email, s.key);
        record("ok", { server_key: s.key, attempted, cache: cached === s.key ? "hit" : cached ? "stale" : "miss" });
        return { sock, reader: r.reader, server: s, reply: r.reply };
      }
      rejectedByBackend = true;
      sock.destroy();
    } catch (e) {
      sock.destroy();
      record("fail", { server_key: s.key, reason: "backend_error", error: String(e?.message || e).slice(0, 200) });
    }
  }
  if (!rejectedByBackend) return reject("backend_unavailable", { attempted }, false);
  return reject("auth_failed", { server_key: attempted.at(-1), attempted });
}

/** After login: hand both sockets over to a raw bidirectional pipe. */
export function splice(ctx, client, clientReader, backend, backendReader) {
  const cRest = clientReader.detach();
  const bRest = backendReader.detach();
  backend.setTimeout(0);
  client.setTimeout(ctx.idleMs, () => client.destroy());
  if (bRest.length) client.write(bRest);
  if (cRest.length) backend.write(cRest);
  const kill = () => { client.destroy(); backend.destroy(); };
  client.on("close", kill);
  backend.on("close", kill);
  client.on("error", kill);
  backend.on("error", kill);
  client.pipe(backend);
  backend.pipe(client);
}

/** Accept a client connection: apply connection limits and pre-login timeout, run the protocol handler. */
export function handleConnection(sock, handler, ctx) {
  const ip = cleanIp(sock.remoteAddress);
  sock.on("error", () => {});
  if (!ctx.conns.acquire(ip)) { sock.destroy(); return; }
  let released = false;
  sock.on("close", () => { if (!released) { released = true; ctx.conns.release(ip); } });
  sock.setTimeout(ctx.preloginMs, () => sock.destroy());
  Promise.resolve()
    .then(() => handler(sock, ip, ctx))
    .catch(() => sock.destroy());
}
