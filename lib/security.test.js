// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createLoginLimiter, ensureFirstAdmin } from "./security.js";

describe("createLoginLimiter", () => {
  const make = () => createLoginLimiter({ perIp: 4, perAccount: 2, windowSec: 60 });

  it("blocks an account from one IP without locking it for others", () => {
    const l = make();
    l.begin("1.1.1.1", "a@x.com").fail();
    l.begin("1.1.1.1", "A@x.com").fail();
    expect(l.begin("1.1.1.1", "a@x.com")).toBeNull();
    expect(l.begin("2.2.2.2", "a@x.com")).not.toBeNull();
  });

  it("limits one IP spraying many accounts", () => {
    const l = make();
    for (const n of [1, 2, 3, 4]) l.begin("1.1.1.1", `u${n}`).fail();
    expect(l.begin("1.1.1.1", "u5")).toBeNull();
  });

  it("counts attempts that are still in flight", () => {
    const l = make();
    expect(l.begin("1.1.1.1", "a")).not.toBeNull();
    expect(l.begin("1.1.1.1", "a")).not.toBeNull();
    expect(l.begin("1.1.1.1", "a")).toBeNull();
  });

  it("does not count released or successful attempts, and only counts once", () => {
    const l = make();
    for (let i = 0; i < 10; i++) l.begin("1.1.1.1", "a").release();
    const t = l.begin("1.1.1.1", "a");
    t.success();
    t.fail();
    expect(l.begin("1.1.1.1", "a")).not.toBeNull();
  });

  it("forgets failures after the window", () => {
    const l = make();
    l.begin("1.1.1.1", "a").fail();
    l.begin("1.1.1.1", "a").fail();
    expect(l.begin("1.1.1.1", "a", Date.now() + 61_000)).not.toBeNull();
  });
});

describe("ensureFirstAdmin", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "mam-admin-"));
  const hash = async (p) => `hashed:${p}`;

  it("never recreates a deleted default admin", async () => {
    const db = { users: [{ username: "owner" }] };
    expect(await ensureFirstAdmin({ db, username: "admin", dataDir: dir(), hash })).toBeNull();
    expect(db.users).toHaveLength(1);
  });

  it("generates a random password into a 0600 file", async () => {
    const d = dir();
    const db = { users: [] };
    const r = await ensureFirstAdmin({ db, username: "admin", dataDir: d, hash });
    const pw = fs.readFileSync(r.passwordFile, "utf8").trim();
    expect(pw.length).toBeGreaterThanOrEqual(20);
    expect(db.users[0].password_hash).toBe(`hashed:${pw}`);
    expect(fs.statSync(r.passwordFile).mode & 0o777).toBe(0o600);
  });

  it("uses a given password without writing it anywhere", async () => {
    const d = dir();
    const db = { users: [] };
    const r = await ensureFirstAdmin({ db, username: "admin", password: "from-env", dataDir: d, hash });
    expect(r.generated).toBe(false);
    expect(fs.readdirSync(d)).toEqual([]);
  });
});
