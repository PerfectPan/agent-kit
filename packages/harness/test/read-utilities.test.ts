import { expect, it } from "vite-plus/test";
import * as z from "zod/mini";
import { lenient } from "../src/lib/lenient.js";

it("keeps explicit fallbacks, successful parsing and whole-array rejection", () => {
  const fallback: string[] = [];
  const schema = lenient(z.array(z.string()), fallback);
  expect(z.parse(schema, undefined)).toBe(fallback);
  expect(z.parse(schema, ["text", 1])).toBe(fallback);
  expect(z.parse(schema, ["text"])).toEqual(["text"]);
  expect(z.parse(lenient(z.optional(z.number()), undefined), false)).toBeUndefined();
});

import { jsonText } from "../src/lib/json.js";
import { ownValue } from "../src/lib/own-value.js";

it("formats JSON without altering the value and ignores inherited keys", () => {
  expect(jsonText({ a: [null, true] })).toBe('{\n  "a": [\n    null,\n    true\n  ]\n}\n');
  expect(ownValue({ value: 0 }, "value")).toBe(0);
  expect(ownValue({}, "constructor")).toBeUndefined();
});
