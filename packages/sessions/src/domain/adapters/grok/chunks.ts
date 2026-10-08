/** Grok's per-update metadata key (`promptIndex`, `modelId`, `hideFromScrollback`). */
export const GROK_META_KEY = "_meta";

const REMINDER_ONLY = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

/** A user chunk the host adds: hidden from scrollback, or only a `<system-reminder>` block. Not a prompt. */
export function isInjectedChunk(meta: Record<string, unknown> | undefined, text: string): boolean {
  return meta?.hideFromScrollback === true || REMINDER_ONLY.test(text);
}
