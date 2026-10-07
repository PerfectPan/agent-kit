import * as Effect from "effect/Effect";

/** File names stay well under the usual 255-byte limit even with a suffix such as `.lease.json.stale`. */
const MAX_LENGTH = 160;

/**
 * The part of a file name that stands for `key`. Percent-encoding keeps `/`, `.` and other separators from forming a
 * path; a longer key keeps a readable prefix and a SHA-256 of the whole key.
 */
export function keyFileName(key: string): Effect.Effect<string> {
  const encoded = encodeURIComponent(key).replace(
    /[!'()*.~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  if (encoded.length <= MAX_LENGTH) {
    return Effect.succeed(encoded);
  }
  return Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).pipe(
    Effect.map((digest) => {
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${encoded.slice(0, 64)}~${hex}`;
    })
  );
}
