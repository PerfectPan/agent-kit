import { describe, expect, it } from "vite-plus/test";

import { definedFields } from "./defined-fields.js";

describe("definedFields", () => {
  it("drops undefined-valued keys and keeps every other value, an empty string included", () => {
    const fields = definedFields({ a: 1, b: undefined, c: "", d: 0 });
    expect(fields).toEqual({ a: 1, c: "", d: 0 });
  });

  it("types a field that may be undefined optional without undefined, and a certain field required", () => {
    const build = (id: string | undefined, name: string) => definedFields({ id, name });
    const fields = build(undefined, "n");
    // `id` is optional without undefined and `name` is required, so both assignments typecheck.
    const typed: { id?: string; name: string } = fields;
    expect(typed.id).toBeUndefined();
    expect(typed.name).toBe("n");
  });

  it("keeps the key order the literal wrote", () => {
    const fields = definedFields({ first: undefined, second: 2, third: 3 });
    expect(Object.keys(fields)).toEqual(["second", "third"]);
  });
});
