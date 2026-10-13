import { describe, expect, it } from "vite-plus/test";

import { type Document, isDocumentRecord, parseDocument } from "./document.js";

/** A record whose prototype jsonc-parser would have created from a `"__proto__"` key, with one own field. */
function turnedRecord(): Record<string, Document> {
  const turned: Record<string, Document> = Object.create({ x: 1 });
  turned.hooks = {};
  return turned;
}

describe("isDocumentRecord", () => {
  it("accepts records, including one whose prototype the parser created from a __proto__ key", () => {
    // jsonc-parser turns a `"__proto__"` key into the parsed object's prototype; see the `Document` comment and the
    // JSONC entries tests of config-editors.test.ts. Such a record stays a record here, prototype included.
    expect(isDocumentRecord(turnedRecord())).toBe(true);
    expect(isDocumentRecord({ hooks: {} })).toBe(true);
    expect(isDocumentRecord(Object.create(null))).toBe(true);
  });

  it("rejects every other document value: lists, dates, scalars and undefined", () => {
    expect(isDocumentRecord([])).toBe(false);
    expect(isDocumentRecord(new Date())).toBe(false);
    expect(isDocumentRecord(null)).toBe(false);
    expect(isDocumentRecord("x")).toBe(false);
    expect(isDocumentRecord(1)).toBe(false);
    expect(isDocumentRecord(true)).toBe(false);
    expect(isDocumentRecord(undefined)).toBe(false);
  });

  it("parses a __proto__-prototyped record the parser produces, which isPlainObject would refuse", () => {
    const turned = turnedRecord();
    expect(parseDocument(turned)).toBe(turned);
  });
});
