import * as z from "zod/mini";

/**
 * A parsed configuration document: what JSON (with comments) or TOML holds — JSON's values plus TOML's dates, big
 * integers, infinities and NaN. The schema validates the tree and hands the parser's own objects over unchanged, so
 * an untouched subtree keeps its identity and an own `"__proto__"` key survives an edit; readers of a document use
 * own-key accessors, so no prototype member can be found through it. A record is any object that is not a list or a
 * date: jsonc-parser turns a `"__proto__"` key into the object's prototype, so the prototype is not judged.
 */
export type Document =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | readonly Document[]
  | { readonly [key: string]: Document };

/** Every JS number a configuration may hold: the finite ones, and TOML's infinities and NaN. */
const NonFinite = z.custom<number, unknown>((value) => typeof value === "number" && !Number.isFinite(value));

const doc: z.ZodMiniType<Document> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    NonFinite,
    z.bigint(),
    z.string(),
    z.instanceof(Date),
    z.array(doc),
    // The record branch: a record whose values are document values, kept as the parser returned it.
    // `unknown` because the check runs on unvalidated parser output; the inferred parameter type only claims a record.
    z.custom<{ readonly [key: string]: Document }>((value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
        return false;
      }
      return Object.keys(value).every((key) => doc.safeParse((value as Record<string, unknown>)[key]).success);
    })
  ])
);

/**
 * The parsed document of a configuration file, or `undefined` when the value is one the schema does not model — a
 * parser output outside JSON and TOML's values, which the callers refuse as an invalid document.
 */
export function parseDocument(value: unknown): Document | undefined {
  const parsed = doc.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The record branch of a document: lists and dates are not records. */
export function isDocumentRecord(
  value: Document | undefined
): value is Extract<Document, { readonly [key: string]: Document }> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}
