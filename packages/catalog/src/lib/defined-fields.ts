/**
 * The object with its `undefined`-valued keys turned optional without `undefined`, and the keys that cannot hold
 * `undefined` kept required: the type of `definedFields`' result. The intersection keeps the two key groups apart,
 * which one mapped type cannot: the optional modifier applies to all of its keys.
 */
export type DefinedFields<T> = {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
} & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

/**
 * The object without its `undefined`-valued keys: the conditional-spread builders `...(x === undefined ? {} : { key: x })`
 * and `...(x ? { key: x } : {})` become one literal with every key written out, so a key is never dropped and a
 * `""` or `0` is not lost to a truthiness test. The input is a plain record — the literal a spread would have copied —
 * whose own enumerable fields, string- or symbol-keyed, are what the copy and the strip see; prototype fields are not
 * part of a record. The assertion is the helper's own boundary, where the shape read out of the value is the point.
 */
export function definedFields<T extends Record<string, unknown>>(value: T): DefinedFields<T> {
  const fields = { ...value } as Record<string | symbol, unknown>;
  for (const key of Reflect.ownKeys(fields)) {
    if (fields[key] === undefined) {
      delete fields[key];
    }
  }
  return fields as DefinedFields<T>;
}
