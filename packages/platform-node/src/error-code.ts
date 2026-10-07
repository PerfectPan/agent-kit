/** Whether `error` is a Node system error with one of `codes`, such as `ENOENT`. */
export function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code);
}
