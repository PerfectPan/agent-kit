import { asRecord, asString } from "../record-fields.js";

/** Grok's per-update metadata key (`promptIndex`, `modelId`, `hideFromScrollback`). */
export const GROK_META_KEY = "_meta";

const REMINDER_ONLY = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;

/** A user chunk the host adds: hidden from scrollback, or only a `<system-reminder>` block. Not a prompt. */
export function isInjectedChunk(meta: Record<string, unknown> | undefined, text: string): boolean {
  return meta?.hideFromScrollback === true || REMINDER_ONLY.test(text);
}

/** Text of a message chunk: a string, `{ text }`, or parts whose text is nested under `content`. */
export function chunkText(content: unknown): string {
  const direct = asString(asRecord(content)?.text);
  if (direct) {
    return direct;
  }
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const inner = asRecord(part);
      const nested = asRecord(inner?.content);
      return asString(nested?.text) ?? asString(inner?.text) ?? "";
    })
    .join("");
}

/** The `session/update` body, whether it sits under `params` or on the record. */
export function updateOf(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return asRecord(asRecord(record?.params)?.update) ?? asRecord(record?.update);
}
