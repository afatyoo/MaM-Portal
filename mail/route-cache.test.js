// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { RouteCache } from "./route-cache.js";

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mam-cache-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const make = (opts = {}) =>
  new RouteCache({ file: path.join(dir, "cache.json"), log: () => {}, ...opts });

describe("RouteCache", () => {
  it("stores an address lowercased and reads it back", () => {
    const c = make();
    expect(c.get("alice@a.com")).toBeNull();
    expect(c.set("Alice@A.com", "MaMKey_2")).toBe(true);
    expect(c.get("alice@a.com")).toBe("MaMKey_2");
    expect(c.get("ALICE@a.com")).toBe("MaMKey_2");
    expect(c.stats()).toMatchObject({ entries: 1, hits: 2, misses: 1 });
  });

  it("refuses keys that could not be an address", () => {
    const c = make();
    expect(c.set("not-an-email", "MaMKey_1")).toBe(false);
    expect(c.set("a@b.com\r\ninjected", "MaMKey_1")).toBe(false);
    expect(c.set("a@b.com", "")).toBe(false);
    expect(c.map.size).toBe(0);
  });

  it("expires entries after the ttl", () => {
    const c = make({ ttlMs: 1000 });
    c.set("a@b.com", "MaMKey_1", 0);
    expect(c.get("a@b.com", 500)).toBe("MaMKey_1");
    expect(c.get("a@b.com", 1500)).toBeNull();
    expect(c.map.size).toBe(0);
  });

  it("keeps entries forever when the ttl is 0", () => {
    const c = make({ ttlMs: 0 });
    c.set("a@b.com", "MaMKey_1", 0);
    expect(c.get("a@b.com", 10 ** 12)).toBe("MaMKey_1");
  });

  it("drops the oldest entries above maxEntries", () => {
    const c = make({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) c.set(`u${i}@b.com`, "MaMKey_1", i);
    expect(c.map.size).toBe(3);
    expect(c.get("u0@b.com")).toBeNull();
    expect(c.get("u4@b.com")).toBe("MaMKey_1");
    expect(c.stats().dropped).toBe(2);
  });

  it("writes a 0600 file and loads it back", () => {
    const file = path.join(dir, "nested", "cache.json");
    const c = new RouteCache({ file, log: () => {} });
    c.set("a@b.com", "MaMKey_1");
    expect(c.save()).toBe(true);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const again = new RouteCache({ file, log: () => {} });
    expect(again.get("a@b.com")).toBe("MaMKey_1");
    expect(again.stats().entries).toBe(1);
  });

  it("skips expired and malformed entries when loading", () => {
    const file = path.join(dir, "cache.json");
    fs.writeFileSync(file, JSON.stringify({
      v: 1,
      entries: {
        "keep@b.com": { server: "MaMKey_1", at: Date.now() },
        "old@b.com": { server: "MaMKey_1", at: 1 },
        "junk@b.com": { server: "", at: Date.now() },
        "not-an-email": { server: "MaMKey_1", at: Date.now() },
      },
    }));
    const c = new RouteCache({ file, ttlMs: 86_400_000, log: () => {} });
    expect(c.map.size).toBe(1);
    expect(c.get("keep@b.com")).toBe("MaMKey_1");
  });

  it("does not follow a symlink to another file", () => {
    const target = path.join(dir, "secret.json");
    fs.writeFileSync(target, JSON.stringify({ v: 1, entries: { "a@b.com": { server: "X", at: Date.now() } } }));
    const file = path.join(dir, "cache.json");
    fs.symlinkSync(target, file);
    const c = new RouteCache({ file, log: () => {} });
    expect(c.map.size).toBe(0);
    expect(c.loadError).not.toBe("");
  });

  it("survives a corrupt file and keeps working in memory", () => {
    const file = path.join(dir, "cache.json");
    fs.writeFileSync(file, "{not json");
    const c = new RouteCache({ file, log: () => {} });
    expect(c.loadError).toContain("not valid JSON");
    expect(c.set("a@b.com", "MaMKey_1")).toBe(true);
    expect(c.get("a@b.com")).toBe("MaMKey_1");
  });

  it("removes the file when the last entry goes away", () => {
    const file = path.join(dir, "cache.json");
    const c = new RouteCache({ file, log: () => {} });
    c.set("a@b.com", "MaMKey_1");
    c.save();
    expect(fs.existsSync(file)).toBe(true);
    c.delete("a@b.com");
    c.save();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("works without a file (memory only)", () => {
    const c = new RouteCache({ file: "", log: () => {} });
    expect(c.set("a@b.com", "MaMKey_1")).toBe(true);
    expect(c.get("a@b.com")).toBe("MaMKey_1");
    expect(c.save()).toBe(false);
    expect(c.stats()).toMatchObject({ enabled: false, entries: 1 });
  });

  it("clears every entry", () => {
    const c = make();
    c.set("a@b.com", "MaMKey_1");
    c.set("c@d.com", "MaMKey_2");
    expect(c.clear()).toBe(2);
    expect(c.map.size).toBe(0);
    expect(c.clear()).toBe(0);
  });
});
