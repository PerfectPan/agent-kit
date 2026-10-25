/**
 * What one model costs above its long-context threshold, in USD per million tokens, as LiteLLM lists it under its
 * `*_above_<N>k_tokens` fields. A request whose total input (cache reads and writes included) exceeds
 * `thresholdTokens` bills whole — every token of it, not only the ones past the threshold — at these rates; a rate
 * absent here keeps the model's base price of that kind, and a cache kind neither the tier nor the base prices bills
 * at the tier's input price.
 */
export interface PriceTier {
  /** The total input a request must exceed, from the `<N>k` of the field names: 272000 for `_above_272k_tokens`. */
  readonly thresholdTokens: number;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  /** Cache writes with the default (five-minute) lifetime, above the threshold. */
  readonly cacheWrite?: number;
  /** One-hour cache writes above the threshold; the base one-hour price applies when absent. */
  readonly cacheWrite1h?: number;
}

/**
 * What one model costs, in USD per million tokens. `input` is the price of input that was neither read from nor
 * written to a cache; a provider without a separate cache price repeats `input` for it.
 */
export interface Price {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  /** Cache writes with the default (five-minute) lifetime. */
  readonly cacheWrite: number;
  /** Anthropic's one-hour cache writes; `cacheWrite` applies when absent. */
  readonly cacheWrite1h?: number;
  /** LiteLLM's long-context tier; absent when it prices no long context on the model. */
  readonly longContext?: PriceTier;
}
