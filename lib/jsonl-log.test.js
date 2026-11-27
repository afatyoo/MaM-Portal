// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { appendJsonl, tailJsonl, MAX_FIELD } from "./jsonl-log.js";
import { csrfReason, resolveSessionSecret } from "./web-guard.js";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "mam-log-"));

describe("jsonl log", () => {
  it("clips long fields", () => {
    const f = path.join(dir(), "l.jsonl");
    appendJsonl(f, { email: "a".repeat(100000) });
    expect(fs.statSync(f).size).toBeLessThan(MAX_FIELD + 50);
  });

  it("rotates, keeps a bounded number of files and tails across a rotation", () => {
    const d = dir();
    const f = path.join(d, "l.jsonl");
    for (let i = 0; i < 40; i++) appendJsonl(f, { i }, { maxBytes: 60, keep: 2 });
    expect(fs.readdirSync(d).sort()).toEqual(["l.jsonl", "l.jsonl.1", "l.jsonl.2"]);
    expect(tailJsonl(f, 8).map((e) => e.i)).toEqual([39, 38, 37, 36, 35, 34, 33, 32]);
  });

  it("reads only the end of a big file and does not throw on write errors", () => {
    const f = path.join(dir(), "l.jsonl");
    for (let i = 0; i < 100; i++) appendJsonl(f, { i });
    expect(tailJsonl(f, 1000, { maxRead: 100 }).length).toBeLessThan(20);
    expect(() => appendJsonl("/nonexistent/dir/x", { a: 1 })).not.toThrow();
  });
});

describe("csrfReason", () => {
  const req = (headers, method = "POST") => ({ method, headers: { host: "mam.test:8443", ...headers } });
  it("allows same origin JSON and non-browser clients", () => {
    expect(csrfReason(req({ "content-type": "application/json; charset=utf-8", origin: "https://mam.test:8443" }))).toBe("");
    expect(csrfReason(req({ "sec-fetch-site": "same-origin", origin: "http://localhost:5173" }))).toBe("");
    expect(csrfReason(req({}))).toBe("");
  });
  it("rejects forms and other origins, including sibling subdomains", () => {
    expect(csrfReason(req({ "content-type": "application/x-www-form-urlencoded" }))).toBe("content_type");
    expect(csrfReason(req({ "sec-fetch-site": "same-site" }))).toBe("cross_origin");
    expect(csrfReason(req({ origin: "https://evil.test" }, "DELETE"))).toBe("cross_origin");
    expect(csrfReason(req({ origin: "null" }))).toBe("cross_origin");
  });
});

describe("resolveSessionSecret", () => {
  it("replaces the placeholder with a persisted random value", () => {
    const d = dir();
    const a = resolveSessionSecret("CHANGE_ME_SESSION_SECRET", d);
    expect(a).toHaveLength(64);
    expect(resolveSessionSecret("", d)).toBe(a);
    expect(resolveSessionSecret("my-own-secret", d)).toBe("my-own-secret");
  });
});
