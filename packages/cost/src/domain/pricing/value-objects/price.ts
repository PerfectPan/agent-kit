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
}
