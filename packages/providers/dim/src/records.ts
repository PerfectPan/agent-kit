import { compactUsage, type Usage } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";
import { lenient } from "@rivus/agent-kit-sessions/spi";

// One rule both the sessions entry (the request events of a loaded transcript) and the usage entry (the decoder)
// read: the `usage_ledger` row's JSON, in the AI-SDK keys DimCode writes.

export interface DimLedgerRowValue {
  ledgerId?: string;
  sessionId?: string;
  runId?: string;
  providerId?: string;
  modelId?: string;
  usage?: string;
  cost?: number | null;
  createdAt?: string;
  [field: string]: unknown;
}

const DimLedgerRow = z.looseObject({
  ledgerId: lenient(z.optional(z.string())),
  sessionId: lenient(z.optional(z.string())),
  runId: lenient(z.optional(z.string())),
  providerId: lenient(z.optional(z.string())),
  modelId: lenient(z.optional(z.string())),
  usage: lenient(z.string()),
  cost: lenient(z.optional(z.number())),
  createdAt: lenient(z.optional(z.string()))
});

const DimLedgerUsage = z.looseObject({
  promptTokens: lenient(z.optional(z.number())),
  completionTokens: lenient(z.optional(z.number())),
  totalTokens: lenient(z.optional(z.number())),
  cacheReadTokens: lenient(z.optional(z.number())),
  cacheWriteTokens: lenient(z.optional(z.number()))
});

/** A `usage_ledger` row's columns beside its JSON; `undefined` for anything else. */
export function dimLedgerRowOf(value: unknown): DimLedgerRowValue | undefined {
  return z.safeParse(DimLedgerRow, value).data;
}

/** The kit usage of a ledger row's JSON; `undefined` without both counts. */
export function dimLedgerUsage(value: string | undefined): Usage | undefined {
  if (value === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  const usage = z.safeParse(DimLedgerUsage, parsed).data;
  if (usage === undefined || usage.promptTokens === undefined || usage.completionTokens === undefined) {
    return undefined;
  }
  return compactUsage({
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {})
  });
}
