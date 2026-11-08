import { constants, zstdCompressSync } from "node:zlib";

/** Synthetic DeepSeek Harness session fixtures, generated in memory; nothing is copied from real sessions. */

export const T = Date.parse("2026-01-01T00:00:00.000Z");

export const header = (id: string, extra: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({ type: "session", version: 4, id, createdAt: T, cwd: "/u/me/work", ...extra });

export const event = (type: string, seq: number, time: number, data: unknown): string =>
  JSON.stringify({ type, seq, time, data });

/** An `assistant/message` line, with `usage` and an optional `message.source`. */
export const message = (
  seq: number,
  time: number,
  usage: Readonly<Record<string, number>> | undefined,
  source: Readonly<Record<string, unknown>> = {}
): string =>
  event("assistant/message", seq, time, {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      id: `m${seq}`,
      ...(Object.keys(source).length === 0 ? {} : { source })
    },
    // JSON.stringify drops an undefined `usage`; the key is absent then.
    usage
  });

/**
 * One Zstandard frame per durable batch of whole lines, checksummed, exactly as the harness's
 * `compressZstdFrame` writes it. Frames are generated with `node:zlib` at test time, so no binary
 * fixture is committed.
 */
export const frame = (batch: readonly string[]): Buffer =>
  zstdCompressSync(`${batch.join("\n")}\n`, { params: { [constants.ZSTD_c_checksumFlag]: 1 } });

export const zstdFile = (...batches: readonly (readonly string[])[]): Uint8Array =>
  Buffer.concat(batches.map((batch) => frame(batch)));

/** A plain log: model fallback, cache counts, and bookkeeping requests without usage. 2 records. */
export const plainLines: readonly string[] = [
  header("dsh-plain-1"),
  event("request/header", 1, T + 1, { header: { config: { provider: "test-provider", model: "test-model" } } }),
  message(2, T + 2, { inputTokens: 100, outputTokens: 10, totalTokens: 135, cacheReadTokens: 20, cacheWriteTokens: 5 }),
  message(
    3,
    T + 3,
    { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    { model: "other-model", provider: "test-provider" }
  ),
  message(4, T + 4, undefined),
  event("web/deepseek-search-llm-request", 5, T + 5, { route: { model: "search-model" } }),
  event("session/title-llm-request", 6, T + 6, { route: { model: "title-model" } })
];

/** A compaction summary that carries the summarization call's usage in its data. */
export const compactionSummaryLine = (seq: number, time: number): string =>
  event("compaction/summary", seq, time, {
    compactionId: "c1",
    summary: [{ type: "text", text: "the earlier turns" }],
    shadowedSeqs: [0],
    shadowedTokenCount: 100,
    provider: "compaction-provider",
    model: "compaction-model",
    usage: { inputTokens: 5000, outputTokens: 300, totalTokens: 5300, cacheReadTokens: 900 }
  });

/** A seeded log: inherited events (including a usage-carrying compaction summary), the inherited end-seed, then one real request. 1 record. */
export const seededBatches: readonly (readonly string[])[] = [
  [header("dsh-seeded-2", { isSeeded: true, createdAt: T + 3 })],
  [
    message(1, T + 1, { inputTokens: 999, outputTokens: 9, totalTokens: 1008 }, { model: "parent-model" }),
    event("session/end-seed", 2, T + 2, { inherited: true }),
    compactionSummaryLine(3, T + 2)
  ],
  [message(4, T + 3, { inputTokens: 7, outputTokens: 3, totalTokens: 10 }, { model: "child-model" })],
  [event("session/title-llm-request", 5, T + 4, { route: { model: "title-model" } })]
];

/** Two requests in separate frames, for cursor resume checks. 2 records. */
export const multiBatches: readonly (readonly string[])[] = [
  [header("dsh-multi-3")],
  [
    event("request/header", 1, T + 1, { header: { config: { provider: "p", model: "m" } } }),
    message(2, T + 2, { inputTokens: 4, outputTokens: 1, totalTokens: 5 })
  ],
  [message(3, T + 3, { inputTokens: 5, outputTokens: 2, totalTokens: 7 })],
  [event("session/title", 4, T + 4, { title: "x" })]
];

/** A header of a format generation the adapter does not read. */
export const unknownGenerationLine: string = header("dsh-v3-5", { version: 3 });

/** A log whose second header must not reopen the seeded skip. 2 records. */
export const doubleHeaderBatches: readonly (readonly string[])[] = [
  [header("dsh-double-6")],
  [
    event("request/header", 1, T + 1, { header: { config: { provider: "p", model: "m" } } }),
    message(2, T + 2, { inputTokens: 4, outputTokens: 1, totalTokens: 5 })
  ],
  [header("dsh-double-6", { isSeeded: true })],
  [message(3, T + 3, { inputTokens: 5, outputTokens: 2, totalTokens: 7 })]
];

/**
 * A fork of a fork: C inherits B's prefix, which ends with B's own inherited marker, plus B's own request; only
 * C's own request counts. 1 record.
 */
export const nestedForkBatches: readonly (readonly string[])[] = [
  [header("dsh-nested-C", { isSeeded: true, parentSession: "dsh-nested-B", createdAt: T + 100 })],
  [
    event("user/message", 0, T + 1, { role: "user", content: [{ type: "text", text: "q" }], source: { kind: "user" } }),
    message(1, T + 2, { inputTokens: 10, outputTokens: 1, totalTokens: 11 }, { model: "a-model" }),
    event("session/end-seed", 2, T + 2, { inherited: true }),
    message(3, T + 50, { inputTokens: 10, outputTokens: 1, totalTokens: 11 }, { model: "b-model" }),
    event("session/end-seed", 4, T + 50, { inherited: true })
  ],
  [message(5, T + 200, { inputTokens: 10, outputTokens: 1, totalTokens: 11 }, { model: "c-model" })]
];
