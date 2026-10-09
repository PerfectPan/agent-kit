import { describe, expect, it } from "vite-plus/test";

import { checkLedgerVersion } from "../../domain/ledger/index.js";
import { decodePreImage, storedLedgerEnvelope } from "./ledger-file.js";

describe("storedLedgerEnvelope", () => {
  it("reads a value that is no record as an envelope without fields", () => {
    for (const raw of [undefined, null, "1", 1, [], { entries: {} }]) {
      expect(storedLedgerEnvelope(raw)).toEqual({ schemaVersion: undefined, revision: undefined });
    }
  });

  it("reads the version and the revision as whatever the file holds", () => {
    expect(storedLedgerEnvelope({ schemaVersion: "1", revision: "3" })).toEqual({
      schemaVersion: "1",
      revision: "3"
    });
    expect(storedLedgerEnvelope({ schemaVersion: 1, revision: null })).toEqual({
      schemaVersion: 1,
      revision: null
    });
    expect(storedLedgerEnvelope({ schemaVersion: 1, revision: 3 })).toEqual({
      schemaVersion: 1,
      revision: 3
    });
    for (const envelope of [storedLedgerEnvelope({ schemaVersion: "1" }), storedLedgerEnvelope(null)]) {
      expect(checkLedgerVersion(envelope)).toMatchObject({
        ok: false,
        error: { _tag: "LedgerVersionUnsupported" }
      });
    }
  });
});

describe("decodePreImage", () => {
  it("reads the content as it was, and nothing for a blob it cannot read", () => {
    expect(decodePreImage('{"content":{"a/b.c":"text"}}')).toEqual({ "a/b.c": "text" });
    expect(decodePreImage('{"content":["line", null, 1, true]}')).toEqual(["line", null, 1, true]);
    expect(decodePreImage('{"content":{"wide":1e400}}')).toEqual({ wide: Infinity });
    expect(decodePreImage('{"content":{"__proto__":"x"}}')).toEqual(JSON.parse('{"__proto__":"x"}'));
    expect(decodePreImage('{"content":null}')).toBeNull();
    expect(decodePreImage("{}")).toBeUndefined();
    expect(decodePreImage("not JSON")).toBeUndefined();
  });
});
