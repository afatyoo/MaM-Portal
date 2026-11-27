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

