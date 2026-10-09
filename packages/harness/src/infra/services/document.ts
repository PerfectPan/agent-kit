import * as z from "zod/mini";

/**
 * A parsed configuration document: what JSON (with comments) or TOML holds. TOML adds its dates to JSON's values;
 * both are read as a tree of records, arrays and scalars, so the editors navigate a typed document instead of
 * `unknown`. The schema passes every value through unchanged: untouched subtrees keep the objects and Dates the
 * parser returned, which the editors' format-preserving writes rely on.
 */
export type Document =
  | null
  | boolean
  | number
  | string
  | Date
  | readonly Document[]
  | { readonly [key: string]: Document };

const doc: z.ZodMiniType<Document> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.instanceof(Date), z.array(doc), z.record(z.string(), doc)])
);

/**
 * The parsed document of a configuration file, or `undefined` when the value is one the schema does not model — a
 * parser output outside JSON and TOML dates, which the callers refuse as an invalid document.
 */
export function parseDocument(value: unknown): Document | undefined {
  const parsed = doc.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The record branch of a document: arrays and dates are not records. */
export function isDocumentRecord(
  value: Document | undefined
): value is Extract<Document, { readonly [key: string]: Document }> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
