import { describe, expect, it } from "vitest";

import { canonicalContent, isContentHash } from "./content-hash.js";

describe("canonicalContent", () => {
  it("drops CRLF line endings from file and managed-block text", () => {
    expect(canonicalContent("file", "a\r\nb\r\n")).toBe(canonicalContent("file", "a\nb\n"));
    expect(canonicalContent("managed-block", "x\r\n")).toBe("x\n");
  });

  it("serializes entries with sorted keys at every depth, so key order does not change the hash", () => {
    const a = canonicalContent("json-entry", {
      type: "command",
      command: "run",
      options: { z: 1, a: [2, { y: 3, b: 4 }] }
    });
    const b = canonicalContent("json-entry", {
      options: { a: [2, { b: 4, y: 3 }], z: 1 },
      command: "run",
      type: "command"
    });
    expect(a).toBe(b);
    expect(a).toBe('{"command":"run","options":{"a":[2,{"b":4,"y":3}],"z":1},"type":"command"}');
  });

  it("keeps a string entry as a JSON string and leaves its line endings alone", () => {
    expect(canonicalContent("json-entry", "a\r\nb")).toBe('"a\\r\\nb"');
    expect(canonicalContent("toml-entry", "./plugins/x.js")).toBe('"./plugins/x.js"');
  });

  it("normalizes each file of a directory and orders them by path", () => {
    expect(canonicalContent("dir", { "z.md": "z\r\n", "SKILL.md": "s\r\n" })).toBe(
      canonicalContent("dir", { "SKILL.md": "s\n", "z.md": "z\n" })
    );
  });

  it("keeps a symlink target as it is", () => {
    expect(canonicalContent("symlink", "../shared/skill")).toBe("../shared/skill");
  });
});

describe("isContentHash", () => {
  it("accepts sha256 with 64 lowercase hex digits only", () => {
    expect(isContentHash(`sha256:${"a".repeat(64)}`)).toBe(true);
    expect(isContentHash(`sha256:${"A".repeat(64)}`)).toBe(false);
    expect(isContentHash(`sha256:${"a".repeat(63)}`)).toBe(false);
    expect(isContentHash(`md5:${"a".repeat(64)}`)).toBe(false);
    expect(isContentHash(42)).toBe(false);
  });
});
