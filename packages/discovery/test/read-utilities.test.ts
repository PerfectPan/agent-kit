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
