import type { GrokMetaValue } from "../../../usage/adapters/grok.js";

const REMINDER_ONLY = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

/** A user chunk the host adds: hidden from scrollback, or only a `<system-reminder>` block. Not a prompt. The
 * translation's records arrive with `_meta` parsed; the preview parses its records' meta with `grokMetaOf`. */
export function isInjectedChunk(meta: GrokMetaValue | undefined, text: string): boolean {
  return meta?.hideFromScrollback === true || REMINDER_ONLY.test(text);
}
