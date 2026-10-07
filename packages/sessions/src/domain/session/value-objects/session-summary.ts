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
