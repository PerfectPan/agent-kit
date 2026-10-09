import * as z from "zod/mini";

import { lenient } from "../lenient.js";

/** Grok's per-update metadata: the turn's prompt index, its model, and whether the host hides the chunk. */
export interface GrokMetaValue {
  promptIndex?: number;
  modelId?: string;
  hideFromScrollback?: boolean;
}

const GrokMeta = z.looseObject({
  promptIndex: lenient(z.number()),
  modelId: lenient(z.string()),
  hideFromScrollback: lenient(z.boolean())
});

/** The `_meta` of an update parsed; a `null` or non-record metadata reads as absent. */
export function grokMetaOf(meta: unknown): GrokMetaValue | undefined {
  return z.safeParse(GrokMeta, meta).data ?? undefined;
}

const REMINDER_ONLY = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

/** A user chunk the host adds: hidden from scrollback, or only a `<system-reminder>` block. Not a prompt. */
export function isInjectedChunk(meta: unknown, text: string): boolean {
  return grokMetaOf(meta)?.hideFromScrollback === true || REMINDER_ONLY.test(text);
}
