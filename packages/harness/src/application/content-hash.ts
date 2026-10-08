import * as Effect from "effect/Effect";

import type { ArtifactKind } from "../domain/install-plan/index.js";
import { type ArtifactContent, canonicalContent, type ContentHash } from "../domain/ledger/index.js";

/** SHA-256 of UTF-8 text as 64 lowercase hex digits, with the WebCrypto digest that Node and browsers share. */
export function sha256Hex(text: string): Effect.Effect<string> {
  return Effect.promise(async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

/** The ContentHash of an Artifact: SHA-256 over the domain's canonical form of its content. */
export function hashContent(kind: ArtifactKind, content: ArtifactContent): Effect.Effect<ContentHash> {
  return Effect.map(sha256Hex(canonicalContent(kind, content)), (hex): ContentHash => `sha256:${hex}`);
}
