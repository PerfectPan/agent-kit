/**
 * Numbers about one Session. A number whose capability the transcript does not list is absent; `failedTools` and
 * `turns` are always counted.
 */
export interface SessionSummary {
  turns?: number;
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  compactions?: number;
  subagents?: number;
  failedTools?: number;
  /** Input tokens of each request in order, downsampled to at most 120 points. */
  contextShape?: number[];
}

/**
 * Version of the summary numbers. It changes when a number changes meaning or value for the same files, so that a
 * cache of summaries knows to recompute them.
 */
export const SESSION_SUMMARY_VERSION = 1;

/** One main-lane user prompt of a Session: the kit's prompt rule, its text capped at the caller's `maxChars`. */
export interface SessionPrompt {
  text: string;
}

/** Caps for the user prompts a summary pass collects. */
export interface SessionPromptsOptions {
  /** Keep at most this many prompts: the first ones in transcript order. Must be a non-negative integer. */
  readonly limit: number;
  /** Cap each prompt's text at this many characters. Must be a positive integer. */
  readonly maxChars: number;
}

/** A SessionSummary that also carries the user prompts a caller asked for with the `prompts` option. */
export type SessionSummaryWithPrompts = SessionSummary & { prompts?: SessionPrompt[] };
