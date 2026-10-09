import type { ArtifactKind } from "../../install-plan/value-objects/artifact-locator.js";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * What an Artifact holds: the text of a file or managed block, a symlink's target, a directory's files as
 * `{ "<relative path>": "<text>" }`, or the value of a configuration entry or command-line registration.
 */
export type ArtifactContent = JsonValue;

/** `sha256:` and 64 lowercase hex digits, computed over `canonicalContent`. */
export type ContentHash = `sha256:${string}`;

const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;

export function isContentHash(value: unknown): value is ContentHash {
  return typeof value === "string" && CONTENT_HASH.test(value);
}

const lf = (text: string): string => text.replaceAll("\r\n", "\n");

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const fields = Object.entries(value)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .flatMap(([key, field]) => (field === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(field)}`]));
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The text a ContentHash is computed over, so that content which differs only in line endings or key order hashes
 * the same: text loses CRLF line endings (a file, a managed block, each file of a directory), and every other value
 * is JSON with sorted keys and no whitespace. The domain does no IO and has no digest; the caller hashes this text
 * with SHA-256.
 */
export function canonicalContent(kind: ArtifactKind, content: ArtifactContent): string {
  if (typeof content === "string" && (kind === "file" || kind === "managed-block")) {
    return lf(content);
  }
  if (typeof content === "string" && kind === "symlink") {
    return content;
  }
  if (kind === "dir" && content !== null && typeof content === "object" && !Array.isArray(content)) {
    return canonicalJson(
      Object.fromEntries(
        Object.entries(content).map(([path, text]) => [path, typeof text === "string" ? lf(text) : text])
      )
    );
  }
  return canonicalJson(content);
}
