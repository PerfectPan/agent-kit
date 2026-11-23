import type { RequestPayload } from "../../transcript/value-objects/transcript-event.js";

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
export const SESSION_SUMMARY_VERSION = 4;

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

/**
 * What a price table bills for one request: the fields of its `RequestPayload` that `priceRecord` reads, with the
 * payload's meanings. A field the request does not record is absent.
 */
export type SessionRequestUsage = Pick<
  RequestPayload,
  "model" | "usage" | "granularity" | "modelCalls" | "usageByModel" | "pricingMultiplier"
>;

/**
 * A SessionSummary that also carries what a caller asked for: the user prompts with the `prompts` option, and with
 * `requestUsage` each request's billed fields in transcript order, so a host prices the session request by request,
 * as it prices the loaded transcript.
 */
export type SessionSummaryWithPrompts = SessionSummary & {
  prompts?: SessionPrompt[];
  requestUsage?: SessionRequestUsage[];
};
