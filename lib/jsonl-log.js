// Append-only JSON lines log with bounded fields, size based rotation and tail reads.
import fs from "fs";

export const MAX_FIELD = 300;

/** Shorten every string so a caller cannot write arbitrarily large entries. */
export function clip(value, depth = 0) {
  if (typeof value === "string") return value.length > MAX_FIELD ? value.slice(0, MAX_FIELD) + "…" : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= 3) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clip(v, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) => [k, clip(v, depth + 1)]));
}

function rotate(file, keep) {
  for (let i = keep - 1; i >= 1; i--) {
    if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
  }
  if (keep > 0) fs.renameSync(file, `${file}.1`);
  else fs.truncateSync(file);
}

/** Never throws: a full disk must not take down a login or the mail proxy. */
export function appendJsonl(file, obj, { maxBytes = 10 * 1024 * 1024, keep = 3 } = {}) {
  try {
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* not there yet */ }
    if (maxBytes > 0 && size >= maxBytes) rotate(file, keep);
    fs.appendFileSync(file, JSON.stringify(clip(obj)) + "\n", { encoding: "utf8", mode: 0o600 });
  } catch (e) {
    console.error("[log] gagal menulis log:", e.message);
  }
}

function lastLines(file, limit, maxRead) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch { return []; }
  try {
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, maxRead);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    const lines = buf.toString("utf8").split("\n");
    if (length < size) lines.shift(); // first line is cut in half
    return lines.filter(Boolean).slice(-limit);
  } finally {
    fs.closeSync(fd);
  }
}

/** Newest entries first, reading only the end of the file (and the previous one after a rotation). */
export function tailJsonl(file, limit = 200, { maxRead = 4 * 1024 * 1024 } = {}) {
  const n = Number.isInteger(limit) && limit > 0 ? limit : 200;
  let lines = lastLines(file, n, maxRead);
  if (lines.length < n) lines = [...lastLines(`${file}.1`, n - lines.length, maxRead), ...lines];
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
}
