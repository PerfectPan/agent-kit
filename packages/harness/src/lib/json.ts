export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** JSON as the kit writes whole files: two-space indentation and a final newline. */
export function jsonText(value: JsonValue): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
