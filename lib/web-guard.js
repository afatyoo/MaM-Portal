// Request guards and secrets for the admin side of the web portal.
import crypto from "crypto";
import fs from "fs";
import path from "path";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reject cross-origin state changing requests. SameSite cookies do not stop a
 * request from a sibling subdomain, so check where the browser says it came from.
 * Clients that send neither header (curl, scripts) are not browsers.
 */
export function csrfReason(req) {
  if (SAFE_METHODS.has(req.method)) return "";
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type && type !== "application/json") return "content_type";
  const site = req.headers["sec-fetch-site"];
  if (site) return site === "same-origin" || site === "none" ? "" : "cross_origin";
  const origin = req.headers.origin;
  if (!origin) return "";
  try {
    return new URL(origin).host === req.headers.host ? "" : "cross_origin";
  } catch {
    return "cross_origin";
  }
}

export function csrfGuard(req, res, next) {
  if (csrfReason(req)) return res.status(403).json({ error: "Permintaan lintas origin ditolak" });
  return next();
}

const PLACEHOLDER = /^(change_me.*)?$/i;

/**
 * Use the configured session secret, or generate one once and keep it in the data
 * directory when the config still has the placeholder.
 */
export function resolveSessionSecret(configured, dataDir) {
  const value = String(configured || "").trim();
  if (!PLACEHOLDER.test(value)) return value;
  const file = path.join(dataDir, "session-secret");
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch { /* create it below */ }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, secret + "\n", { mode: 0o600 });
  return secret;
}
