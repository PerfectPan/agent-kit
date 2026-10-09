import * as z from "zod/mini";

/** The `code` of a Node system error, such as `ENOENT`, read off a caught error; `undefined` when it has none. */
const ErrorCode = z.pipe(
  z.instanceof(Error),
  z.transform((error) => ("code" in error && typeof error.code === "string" ? error.code : undefined))
);

/** Whether `error` is a Node system error with one of `codes`, such as `ENOENT`. */
export function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  const parsed = ErrorCode.safeParse(error);
  return parsed.success && parsed.data !== undefined && codes.includes(parsed.data);
}
