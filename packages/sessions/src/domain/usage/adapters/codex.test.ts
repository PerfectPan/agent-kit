import { describe, expect, it } from "vite-plus/test";

import type { SourcedRecord } from "../../transcript/index.js";
import type { UsageRecord } from "../index.js";
import { codexUsage, codexUsageLines } from "./codex.js";

const file = { path: "rollout-1.jsonl", sessionId: "rollout-1", mtimeMs: 1000 };
const AT = "2026-01-01T00:00:01.000Z";

const record = (value: unknown, line = 1): SourcedRecord => ({
  file: file.path,
  offset: 0,
  length: 10,
  line,
  value
});

/** The records a push completes; the decoder under test ends no file, so an error would be a defect. */
const pushed = (result: ReturnType<ReturnType<typeof codexUsageLines>["push"]>): UsageRecord[] => {
  if (!result.ok) {
    throw new Error(`unexpected ${result.error._tag}`);
  }
  return result.value;
};

const usageRecord = (responseId: string, usage: unknown) => ({
  timestamp: AT,
  type: "token_usage_record",
  payload: { response_id: responseId, usage }
});

/** A `token_count` whose totals are the only source of usage: each count's increase over the previous one. */
const totalsCount = (total: unknown) => ({
  timestamp: AT,
  type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: total } }
});

/** A `token_count` whose last call's usage is present, right or not: the totals then only carry the comparison. */
const totalsCountWithLast = (total: unknown, last: unknown) => ({
  timestamp: AT,
  type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } }
});

const inputOf = (records: UsageRecord[]): (number | undefined)[] => records.map((item) => item.usage.inputTokens);

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

describe("codex usage lines", () => {
  it("reads a count of an unexpected type as absent, and a usage object that is no record as none", () => {
    expect(codexUsage({ input_tokens: 10, output_tokens: "3", total_tokens: 15 })).toEqual({
      inputTokens: 10,
      totalTokens: 15
    });
    expect(codexUsage("12 tokens")).toBeUndefined();
  });

  it("fails a record whose envelope names an unknown format generation", () => {
    for (const value of [{}, [1], { formatVersion: 9, type: "session_meta" }, { type: "" }, { record_type: "" }]) {
      expect(codexUsageLines(file).push(record(value))).toEqual({
        ok: false,
        error: { _tag: "UnknownFormatGeneration", agent: "codex", file: file.path, line: 1 }
      });
    }
  });

  it("reads an empty envelope marker as absent: the header rule decides, and names the session", () => {
    const decoder = codexUsageLines(file);
    expect(pushed(decoder.push(record({ record_type: "", id: "cx-empty", timestamp: AT })))).toEqual([]);
    expect(pushed(decoder.push(record(usageRecord("r1", { input_tokens: 10, output_tokens: 1 }))))).toEqual([
      expect.objectContaining({ sessionId: "cx-empty" })
    ]);
  });

  it("names the session from a pre-envelope header, whose id may have any type", () => {
    const named = codexUsageLines(file);
    expect(pushed(named.push(record({ id: "cx-legacy", timestamp: AT })))).toEqual([]);
    expect(pushed(named.push(record(usageRecord("r1", { input_tokens: 10, output_tokens: 1 }))))).toEqual([
      expect.objectContaining({ sessionId: "cx-legacy" })
    ]);
    const unnamed = codexUsageLines(file);
    expect(pushed(unnamed.push(record({ id: 5, timestamp: true })))).toEqual([]);
    expect(pushed(unnamed.push(record(usageRecord("r1", { input_tokens: 10, output_tokens: 1 }))))).toEqual([
      expect.objectContaining({ sessionId: "rollout-1" })
    ]);
  });

  it("reads a usage object of an unexpected type as absent, so the call counts no usage", () => {
    const decoder = codexUsageLines(file);
    expect(pushed(decoder.push(record(usageRecord("r1", "12 tokens"))))).toEqual([]);
    expect(pushed(decoder.push(record(usageRecord("r2", { input_tokens: 1, output_tokens: 1 }))))).toEqual([
      expect.objectContaining({ responseId: "r2" })
    ]);
  });

  it("continues from a saved cursor, reading a field of an unexpected type as absent", () => {
    const decoder = codexUsageLines(file, { lastTime: AT, model: 5, tracker: { usageRecords: true } });
    // A `token_count` behind a cursor that saw a `token_usage_record` is the other usage source, not usage.
    expect(
      pushed(
        decoder.push(
          record({
            timestamp: AT,
            type: "event_msg",
            payload: { type: "token_count", info: { last_token_usage: { input_tokens: 5, output_tokens: 1 } } }
          })
        )
      )
    ).toEqual([]);
    // A record without a time falls back to the file's mtime once `lastTime` reads as absent.
    const fresh = codexUsageLines(file, { lastTime: "2026-01-01T00:00:01.000Z", responses: "r1" });
    const records = pushed(
      fresh.push(record({ type: "token_usage_record", payload: { response_id: "r1", usage: { input_tokens: 1 } } }))
    );
    expect(records.map((item) => [item.timestamp, item.model])).toEqual([[1000, undefined]]);
  });

  it("compares the totals as they were written: a mistyped or absent total never stands in for the last one", () => {
    const nullTwice = codexUsageLines(file);
    expect(
      inputOf([
        ...pushed(nullTwice.push(record(totalsCount({ input_tokens: 100 })))),
        ...pushed(nullTwice.push(record(totalsCount(null)))),
        ...pushed(nullTwice.push(record(totalsCount(null)))),
        ...pushed(nullTwice.push(record(totalsCount({ input_tokens: 150 }))))
      ])
    ).toEqual([100, 150]);
    const mistyped = codexUsageLines(file);
    expect(
      inputOf([
        ...pushed(mistyped.push(record(totalsCount({ input_tokens: 100 })))),
        ...pushed(mistyped.push(record(totalsCount(5)))),
        ...pushed(mistyped.push(record(totalsCount({ input_tokens: 130 }))))
      ])
    ).toEqual([100, 130]);
  });

  it("reads a mistyped last_token_usage as no record, so the totals' increase is the usage", () => {
    for (const mistyped of [5, "x", true, []]) {
      const decoder = codexUsageLines(file);
      expect(
        inputOf([
          ...pushed(decoder.push(record(totalsCount({ input_tokens: 100 })))),
          ...pushed(decoder.push(record(totalsCountWithLast({ input_tokens: 150 }, mistyped))))
        ])
      ).toEqual([100, 50]);
    }
  });

  it("emits a waiting record the caller's cursor does not share", () => {
    const first = codexUsageLines(file);
    expect(
      pushed(
        first.push(record({ timestamp: at(0), type: "session_meta", payload: { id: "cx-f", forked_from_id: "p" } }))
      )
    ).toEqual([]);
    expect(
      pushed(
        first.push(
          record({
            timestamp: at(100),
            type: "event_msg",
            payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1, output_tokens: 1 } } }
          })
        )
      )
    ).toEqual([]);
    const saved = first.save() as { waiting?: { model?: string } };
    const second = codexUsageLines(file, saved);
    // A second usage record at another second settles the first as the rollout's own, so both are emitted.
    const emitted = pushed(
      second.push(
        record({
          timestamp: at(5000),
          type: "event_msg",
          payload: { type: "token_count", info: { last_token_usage: { input_tokens: 2, output_tokens: 1 } } }
        })
      )
    );
    expect(emitted).toHaveLength(2);
    emitted[0]!.model = "mutated";
    expect(saved.waiting?.model).toBeUndefined();
  });
});
