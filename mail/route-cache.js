// Email -> backend cache.
//
// When one domain lives on two servers, the proxy has to try them in order and a
// backend that sleeps on a failed login makes the previous attempt slow (10s+).
// Remembering which server accepted an account turns the next login into a single
// try. The file only holds addresses and server keys, never credentials, and it is
// written with mode 0600 because addresses are still personal data.
import fs from "fs";
import path from "path";
import crypto from "crypto";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SAVE_DELAY_MS = 2000;
const EMAIL_KEY_RE = /^[A-Za-z0-9._%+\-=']{1,128}@[A-Za-z0-9.-]{1,253}$/;

/** Read a file without following symlinks and without trusting its size. */
function readSmallFile(file) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error("not a regular file");
    if (st.size > MAX_FILE_BYTES) throw new Error("cache file too large");
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/** Write through a random temp name, fsync, then rename, so a reader never sees half a file. */
function writeFileAtomic(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0);
  let fd;
  try {
    fd = fs.openSync(tmp, flags, 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export class RouteCache {
  /**
   * @param {object} opts
   * @param {string} opts.file        path of the JSON cache, empty disables persistence
   * @param {number} opts.ttlMs       entry lifetime, 0 keeps entries forever
   * @param {number} opts.maxEntries  hard cap on stored addresses, 0 means no cap
   * @param {(entry:object)=>void} opts.log
   */
  constructor({ file = "", ttlMs = 0, maxEntries = 50000, log = () => {} } = {}) {
    this.file = file;
    this.ttlMs = ttlMs > 0 ? ttlMs : 0;
    this.maxEntries = maxEntries > 0 ? maxEntries : 0;
    this.log = log;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
    this.saves = 0;
    this.dropped = 0;
    this.loadError = "";
    this.lastSavedAt = null;
    this.dirty = false;
    this.timer = null;
    if (this.file) this.load();
  }

  _fresh(entry, now) {
    return !!entry && (this.ttlMs === 0 || now - entry.at < this.ttlMs);
  }

  load(now = Date.now()) {
    if (!this.file) return 0;
    let raw;
    try {
      raw = readSmallFile(this.file);
    } catch (e) {
      if (e.code !== "ENOENT") {
        this.loadError = String(e.message || e).slice(0, 200);
        this.log({ scope: "cache", result: "fail", reason: "load_failed", error: this.loadError });
      }
      return 0;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.loadError = "cache file is not valid JSON";
      this.log({ scope: "cache", result: "fail", reason: "load_failed", error: this.loadError });
      return 0;
    }
    const entries = (parsed && typeof parsed === "object" && parsed.entries) || {};
    let kept = 0;
    for (const [email, entry] of Object.entries(entries)) {
      if (!EMAIL_KEY_RE.test(email)) continue;
      const server = String(entry?.server || "");
      const at = Number(entry?.at || 0);
      if (!server || server.length > 64 || !Number.isFinite(at) || !this._fresh({ server, at }, now)) continue;
      this.map.set(email.toLowerCase(), { server, at });
      kept++;
    }
    this._enforceCap();
    return kept;
  }

  get(email, now = Date.now()) {
    const key = String(email || "").toLowerCase();
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return null; }
    if (!this._fresh(entry, now)) { this.map.delete(key); this.misses++; return null; }
    this.hits++;
    return entry.server;
  }

  set(email, server, now = Date.now()) {
    const key = String(email || "").toLowerCase();
    if (!EMAIL_KEY_RE.test(key) || !server) return false;
    const prev = this.map.get(key);
    if (prev && prev.server === server) { prev.at = now; return false; }
    this.map.delete(key);
    this.map.set(key, { server: String(server).slice(0, 64), at: now });
    this._enforceCap();
    this.dirty = true;
    this._scheduleSave();
    return true;
  }

  delete(email) {
    const removed = this.map.delete(String(email || "").toLowerCase());
    if (removed) { this.dirty = true; this._scheduleSave(); }
    return removed;
  }

  /** Drop every entry; used by the admin endpoint after moving accounts around. */
  clear() {
    const removed = this.map.size;
    this.map.clear();
    if (removed) { this.dirty = true; this._scheduleSave(); }
    return removed;
  }

  _enforceCap(now = Date.now()) {
    if (!this.maxEntries) return;
    for (const [k, v] of this.map) {
      if (this.map.size <= this.maxEntries) break;
      if (!this._fresh(v, now)) { this.map.delete(k); this.dropped++; }
    }
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
      this.dropped++;
    }
  }

  prune(now = Date.now()) {
    let removed = 0;
    for (const [k, v] of this.map) {
      if (!this._fresh(v, now)) { this.map.delete(k); removed++; }
    }
    if (removed) this.dirty = true;
    this._enforceCap(now);
    return removed;
  }

  _scheduleSave() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, SAVE_DELAY_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  save(now = Date.now()) {
    if (!this.file || !this.dirty) return false;
    this.prune(now);
    if (!this.map.size) {
      // Nothing worth keeping: remove the file instead of leaving an empty one.
      try { fs.unlinkSync(this.file); } catch { /* ignore */ }
      this.dirty = false;
      this.lastSavedAt = new Date(now).toISOString();
      return true;
    }
    const entries = {};
    for (const [email, entry] of this.map) entries[email] = { server: entry.server, at: entry.at };
    try {
      writeFileAtomic(this.file, JSON.stringify({ v: 1, saved_at: new Date(now).toISOString(), entries }));
      this.dirty = false;
      this.saves++;
      this.lastSavedAt = new Date(now).toISOString();
      return true;
    } catch (e) {
      this.loadError = String(e.message || e).slice(0, 200);
      this.log({ scope: "cache", result: "fail", reason: "save_failed", error: this.loadError });
      return false;
    }
  }

  /** Flush pending changes; safe to call from an exit handler. */
  close() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.save();
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      enabled: !!this.file,
      file: this.file,
      entries: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hit_rate: total ? Math.round((this.hits / total) * 1000) / 10 : 0,
      saves: this.saves,
      dropped: this.dropped,
      ttl_days: this.ttlMs ? Math.round(this.ttlMs / 86400000) : 0,
      max_entries: this.maxEntries,
      last_saved_at: this.lastSavedAt,
      error: this.loadError,
    };
  }
}
