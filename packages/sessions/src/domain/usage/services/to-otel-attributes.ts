import type { Usage } from "../value-objects/usage.js";

export interface OtelAttributeOptions {
  /**
   * The middle segment of the cache write attribute: `cache_creation` is the name in the released semantic
   * conventions, `cache_write` the one in the GenAI repository that replaces them.
   */
  readonly cacheWriteKey?: "cache_creation" | "cache_write";
}

/**
 * OTel GenAI `gen_ai.usage.*` span attributes. Only counts that are present become attributes. Anthropic's one-hour
 * cache split has no attribute; it stays inside the cache write count.
 */
export function toOtelAttributes(usage: Usage, options: OtelAttributeOptions = {}): Record<string, number> {
  const attributes: Record<string, number> = {};
  const set = (name: string, value: number | undefined): void => {
    if (value !== undefined) {
      attributes[name] = value;
    }
  };
  set("gen_ai.usage.input_tokens", usage.inputTokens);
  set("gen_ai.usage.output_tokens", usage.outputTokens);
  set("gen_ai.usage.cache_read.input_tokens", usage.cacheReadTokens);
  set(`gen_ai.usage.${options.cacheWriteKey ?? "cache_creation"}.input_tokens`, usage.cacheWriteTokens);
  set("gen_ai.usage.reasoning.output_tokens", usage.reasoningTokens);
  return attributes;
}
