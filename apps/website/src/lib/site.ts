/** Vite keeps a trailing slash; router basepaths and URL prefixes do not. */
export function normalizeBasePath(value: string): string {
  return value.replace(/\/+$/, "");
}
