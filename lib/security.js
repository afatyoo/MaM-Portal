// Brute-force protection and first-admin handling for the web side of MaM.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FailLimiter } from "./fail-limiter.js";

/**
 * Failed-login limiter for HTTP endpoints. Counted per client IP and per
 * IP + account, never per account alone, so one source cannot lock out
 * somebody else. Attempts still waiting for an answer count too, so parallel
 * requests cannot overshoot the limit. `perAccountTotal` is an optional, much
 * looser ceiling across all addresses, against guessing spread over many IPs.
 */
export function createLoginLimiter({ perIp = 20, perAccount = 5, perAccountTotal = 0, windowSec = 600, maxKeys = 20000 } = {}) {
  const windowMs = windowSec * 1000;
  const ips = new FailLimiter(perIp, windowMs, maxKeys);
  const accounts = new FailLimiter(perAccount, windowMs, maxKeys);
  const totals = new FailLimiter(perAccountTotal, windowMs, maxKeys);
  const pending = new Map();

  const full = (limiter, key, pendingKey, now) => {
    if (limiter.limit <= 0) return false;
    limiter.blocked(key, now); // drops expired entries
    return (limiter.m.get(key)?.length || 0) + (pending.get(pendingKey) || 0) >= limiter.limit;
  };
  const add = (key, n) => {
    const v = (pending.get(key) || 0) + n;
    if (v > 0) pending.set(key, v); else pending.delete(key);
  };

  return {
    /**
     * Reserve one attempt. Returns null when the caller is over the limit,
     * otherwise { fail, success, release }; exactly the first call takes effect.
     */
    begin(ip, account, now = Date.now()) {
      const ipKey = String(ip || "");
      const name = String(account || "").toLowerCase();
      const accKey = `${ipKey}\n${name}`;
      const totalPending = `total:${name}`;
      const ipPending = `ip:${ipKey}`;
      const accPending = `acc:${accKey}`;
      if (full(ips, ipKey, ipPending, now) || full(accounts, accKey, accPending, now)
        || (name && full(totals, name, totalPending, now))) return null;
      add(ipPending, 1);
      add(accPending, 1);
      add(totalPending, 1);
      let done = false;
      const finish = (effect) => {
        if (done) return;
        done = true;
        add(ipPending, -1);
        add(accPending, -1);
        add(totalPending, -1);
        effect?.();
      };
      return {
        fail: () => finish(() => { ips.fail(ipKey); accounts.fail(accKey); if (name) totals.fail(name); }),
        success: () => finish(() => accounts.reset(accKey)),
        release: () => finish(),
      };
    },
    sweep() { ips.sweep(); accounts.sweep(); totals.sweep(); },
  };
}

export const INITIAL_PASSWORD_FILE = "initial-admin-password";

/**
 * Create the first admin only when there is no admin at all. Without a password
 * from the environment a random one is written to a root/service-only file
 * instead of the log. Mutates `db`; returns null when nothing had to be done.
 */
export async function ensureFirstAdmin({ db, username, password, dataDir, hash }) {
  if (db.users.length > 0) return null;
  const generated = !password;
  const secret = generated ? crypto.randomBytes(15).toString("base64url") : String(password);
  let passwordFile = "";
  if (generated) {
    passwordFile = path.join(dataDir, INITIAL_PASSWORD_FILE);
    fs.rmSync(passwordFile, { force: true });
    fs.writeFileSync(passwordFile, secret + "\n", { mode: 0o600, flag: "wx" });
  }
  db.users.push({ username, password_hash: await hash(secret), created_at: new Date().toISOString() });
  return { username, generated, passwordFile };
}
