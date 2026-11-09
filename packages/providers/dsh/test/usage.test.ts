import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import {
  type DecodeUsageOptions,
  type UsageCursor,
  type UsageDecodeFailure,
  type UsagePlatform,
  type UsageRecord,
  isUsageRecord,
  readOriginal
} from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { dsh } from "../src/identity.js";
import { dshUsageOf } from "../src/records.js";
import { dshSessionAdapter } from "../src/sessions.js";
import { dshUsageDecoder } from "../src/usage.js";
import {
  T,
  compactionSummaryLine,
  doubleHeaderBatches,
  event,
  frame,
  header,
  message,
  multiBatches,
  nestedForkBatches,
  plainLines,
  seededBatches,
  unknownGenerationLine,
  zstdFile
} from "./usage.fixtures.js";

const plainPath = "/u/me/.dsh/sessions/-u-me-work-/plain-1/session.v4.jsonl";
const seededPath = "/u/me/.dsh/sessions/-u-me-work-/seeded-2/session.v4.jsonl.zstd";
const multiPath = "/u/me/.dsh/sessions/-u-me-work-/multi-3/session.v4.jsonl.zstd";

/**
 * A host with the platform-node `decompress` the shell ships; Node's one-shot zstd API decodes only the first frame
 * of a multi-frame input on some versions, so the tests use the real decoder.
 */
const decompressing = (files: Readonly<Record<string, string | Uint8Array>>) => {
  const memory = createMemoryPlatform({ files, chunkSize: 300 });
  const platform: UsagePlatform = { fs: memory.fs, decompress: createNodePlatform().decompress };
  return { memory, platform };
};

type Item = UsageRecord | UsageDecodeFailure;

async function readAll(
  platform: UsagePlatform,
  path: string,
  options: DecodeUsageOptions = {},
  stop?: number
): Promise<{ items: Item[]; cursor: UsageCursor | undefined }> {
  const stream = dshUsageDecoder.decode(platform, { path }, options);
  const items: Item[] = [];
  for await (const item of stream) {
    items.push(item);
    if (stop !== undefined && items.length >= stop) {
      break;
    }
  }
  return { items, cursor: stream.cursor };
}

async function recordsOf(
  platform: UsagePlatform,
  path: string,
  options: DecodeUsageOptions = {}
): Promise<UsageRecord[]> {
  const { items } = await readAll(platform, path, options);
  return items.map((item) => {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    return item;
  });
}

const failTag = (item: Item): string => (isUsageRecord(item) ? "record" : item.error._tag);

describe("dsh usage", () => {
  it("adds cache reads and writes back into the input, keeping the logged total", () => {
    expect(
      dshUsageOf({ inputTokens: 100, outputTokens: 10, totalTokens: 135, cacheReadTokens: 20, cacheWriteTokens: 5 })
    ).toEqual({
      inputTokens: 125,
      outputTokens: 10,
      totalTokens: 135,
      cacheReadTokens: 20,
      cacheWriteTokens: 5
    });
    expect(dshUsageOf({ inputTokens: 3, cacheReadTokens: 2 })).toEqual({ inputTokens: 5, cacheReadTokens: 2 });
    expect(dshUsageOf({ inputTokens: 3 })).toEqual({ inputTokens: 3 });
    expect(dshUsageOf({})).toBeUndefined();
    expect(dshUsageOf("nope")).toBeUndefined();
  });

  it("decodes a plain log: model fallback, cache added back, only assistant messages counted", async () => {
    const { platform } = decompressing({ [plainPath]: `${plainLines.join("\n")}\n` });
    const records = await recordsOf(platform, plainPath, { final: true });
    expect(records.map((record) => [record.requestId, record.responseId, record.model, record.provider])).toEqual([
      ["2", "m2", "test-model", undefined],
      ["3", "m3", "other-model", "test-provider"]
    ]);
    expect(records[0]!.usage).toEqual({
      inputTokens: 125,
      outputTokens: 10,
      totalTokens: 135,
      cacheReadTokens: 20,
      cacheWriteTokens: 5
    });
    expect(records.map((record) => record.timestamp)).toEqual([T + 2, T + 3]);
    expect(records.map((record) => record.sessionId)).toEqual(["dsh-plain-1", "dsh-plain-1"]);
    const keys = records.map((record) => dshUsageDecoder.usageKey(record));
    expect(keys).toEqual(["dsh-plain-1 2", "dsh-plain-1 3"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("skips a seeded session's inherited events and counts what follows", async () => {
    const { platform } = decompressing({ [seededPath]: zstdFile(...seededBatches) });
    const records = await recordsOf(platform, seededPath, { final: true });
    expect(records.map((record) => [record.requestId, record.model, record.sessionId])).toEqual([
      ["4", "child-model", "dsh-seeded-2"]
    ]);
  });

  it("skips a fork of a fork's whole inherited prefix, ending at its last inherited marker", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/nested-C/session.v4.jsonl.zstd";
    const { platform } = decompressing({ [path]: zstdFile(...nestedForkBatches) });
    const records = await recordsOf(platform, path, { final: true });
    expect(records.map((record) => [record.requestId, record.model, record.sessionId])).toEqual([
      ["5", "c-model", "dsh-nested-C"]
    ]);
  });

  it("counts a compaction summary's usage, with the data's own model and provider", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/compaction-8/session.v4.jsonl";
    const { platform } = decompressing({
      [path]: `${[header("dsh-compaction-8"), message(0, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }), compactionSummaryLine(1, T + 2)].join("\n")}\n`
    });
    const records = await recordsOf(platform, path, { final: true });
    expect(records.map((record) => [record.requestId, record.model, record.provider])).toEqual([
      ["0", undefined, undefined],
      ["1", "compaction-model", "compaction-provider"]
    ]);
    expect(records[1]!.usage).toEqual({
      inputTokens: 5900,
      outputTokens: 300,
      totalTokens: 5300,
      cacheReadTokens: 900
    });
  });

  it("counts a compaction file's usage and sessions totals alike", async () => {
    const fixture = await readFile(
      fileURLToPath(new URL("fixtures/sessions/conformance/compaction/session.v4.jsonl", import.meta.url)),
      "utf8"
    );
    const path = "/u/me/.dsh/sessions/-u-me-work-/compaction-9/session.v4.jsonl";
    const { platform } = decompressing({ [path]: fixture });
    const records = await recordsOf(platform, path, { final: true });
    const summary = await dshSessionAdapter.summarize?.(platform, { agent: "dsh", path }, {});
    expect(summary).toBeDefined();
    if (summary === undefined) {
      return;
    }
    expect(summary.ok).toBe(true);
    if (!summary.ok) {
      return;
    }
    const input = records.reduce((sum, record) => sum + (record.usage.inputTokens ?? 0), 0);
    const output = records.reduce((sum, record) => sum + (record.usage.outputTokens ?? 0), 0);
    expect(records.some((record) => record.requestId === "6")).toBe(true);
    expect(summary.value.inputTokens).toBe(input);
    expect(summary.value.outputTokens).toBe(output);
  });

  it("gives every compressed record the sessions reader's source and reads it back", async () => {
    const { platform } = decompressing({ [multiPath]: zstdFile(...multiBatches) });
    const records = await recordsOf(platform, multiPath, { final: true });
    expect(records.map((record) => record.requestId)).toEqual(["2", "3"]);
    const loaded = await dshSessionAdapter.load(platform, { agent: "dsh", path: multiPath });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    for (const record of records) {
      const request = loaded.value.events.find(
        (event) => event.kind === "request" && event.payload.responseId === record.responseId
      );
      expect(request).toBeDefined();
      expect(record.source).toEqual(request?.source);
      const original = await readOriginal(platform, record.source);
      expect(original.ok).toBe(true);
      if (original.ok) {
        expect(original.value).toEqual(request?.original);
      }
    }
  });

  it("reports UnknownFormatGeneration for a header of another generation", async () => {
    const v3Plain = "/u/me/.dsh/sessions/-u-me-work-/v3-5/session.v4.jsonl";
    const { platform } = decompressing({ [v3Plain]: `${unknownGenerationLine}\n` });
    const plain = await readAll(platform, v3Plain, { final: true });
    expect(plain.items.map(failTag)).toEqual(["UnknownFormatGeneration"]);
    const v3Zstd = "/u/me/.dsh/sessions/-u-me-work-/v3-5/session.v4.jsonl.zstd";
    const zstd = decompressing({ [v3Zstd]: zstdFile([unknownGenerationLine]) });
    const compressed = await readAll(zstd.platform, v3Zstd, { final: true });
    expect(compressed.items.map(failTag)).toEqual(["UnknownFormatGeneration"]);
  });

  it("lets only the first header set the seeded state", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/double-6/session.v4.jsonl.zstd";
    const { platform } = decompressing({ [path]: zstdFile(...doubleHeaderBatches) });
    const records = await recordsOf(platform, path, { final: true });
    expect(records.map((record) => record.requestId)).toEqual(["2", "3"]);
  });

  it("resumes a compressed decode after every record without replaying, with the same sources", async () => {
    const { platform } = decompressing({ [multiPath]: zstdFile(...multiBatches) });
    const whole = await recordsOf(platform, multiPath, { final: true });
    expect(whole.map((record) => record.requestId)).toEqual(["2", "3"]);
    expect(whole.every((record) => record.source.codec === "zstd")).toBe(true);
    for (let stop = 1; stop <= whole.length; stop++) {
      const head = await readAll(platform, multiPath, { final: true }, stop);
      const tail = await readAll(platform, multiPath, head.cursor ? { from: head.cursor, final: true } : {});
      expect([...head.items, ...tail.items]).toEqual(whole);
      const complete = await readAll(platform, multiPath, { final: true });
      expect(tail.cursor).toEqual(complete.cursor);
    }
  });

  it("decodes only the frames appended after the cursor, continuing decoded offsets and lines", async () => {
    const full = zstdFile(...seededBatches);
    const { memory, platform } = decompressing({ [seededPath]: full });
    const first = await readAll(platform, seededPath, { final: true });
    expect(first.items.map(failTag)).toEqual(["record"]);
    const grown = Buffer.concat([
      Buffer.from(full),
      frame([message(6, T + 5, { inputTokens: 8, outputTokens: 2, totalTokens: 10 })])
    ]);
    await memory.fs.writeAtomic(seededPath, new Uint8Array(grown));
    const after = await readAll(platform, seededPath, first.cursor ? { from: first.cursor, final: true } : {});
    expect(after.items.map((item) => (isUsageRecord(item) ? item.requestId : item.error._tag))).toEqual(["6"]);
    const whole = await recordsOf(platform, seededPath, { final: true });
    expect([...first.items, ...after.items]).toEqual(whole);
  });

  it("keeps a torn final frame before the cursor and decodes it once it is complete", async () => {
    const complete = zstdFile(
      [header("dsh-torn-4")],
      [message(1, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })]
    );
    const next = frame([message(2, T + 2, { inputTokens: 2, outputTokens: 2, totalTokens: 4 })]);
    const torn = Buffer.concat([Buffer.from(complete), next.subarray(0, 7)]);
    const full = Buffer.concat([Buffer.from(complete), next]);
    const path = "/u/me/.dsh/sessions/-u-me-work-/torn-4/session.v4.jsonl.zstd";
    const { memory, platform } = decompressing({ [path]: torn });
    const first = await readAll(platform, path, { final: true });
    expect(first.items.map(failTag)).toEqual(["record"]);
    expect(first.cursor?.offset).toBe(complete.byteLength);
    await memory.fs.writeAtomic(path, new Uint8Array(full));
    const rest = await readAll(platform, path, first.cursor ? { from: first.cursor, final: true } : {});
    expect(rest.items.map(failTag)).toEqual(["record"]);
    const whole = await recordsOf(platform, path, { final: true });
    expect([...first.items, ...rest.items]).toEqual(whole);
  });

  it("keeps the cursor before a frame whose magic is still being written", async () => {
    const good = zstdFile(
      [header("dsh-magic-7")],
      [message(0, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })]
    );
    // The first two bytes of a new frame's magic, as the writer is appending it.
    const path = "/u/me/.dsh/sessions/-u-me-work-/magic-7/session.v4.jsonl.zstd";
    const { platform } = decompressing({ [path]: Buffer.concat([Buffer.from(good), Buffer.from([0x28, 0xb5])]) });
    const fresh = await readAll(platform, path, { final: true });
    expect(fresh.items.map((item) => (isUsageRecord(item) ? item.requestId : item.error._tag))).toEqual(["0"]);
    expect(fresh.cursor?.offset).toBe(good.byteLength);
    const resumed = await readAll(platform, path, fresh.cursor ? { from: fresh.cursor, final: true } : {});
    expect(resumed.items).toEqual([]);
    expect(resumed.cursor?.offset).toBe(good.byteLength);
  });

  it("resumes a frame of several records through the cursor's queue", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/batch-10/session.v4.jsonl.zstd";
    const { platform } = decompressing({
      [path]: zstdFile(
        [header("dsh-batch-10")],
        [
          message(0, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
          message(1, T + 2, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
          message(2, T + 3, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })
        ],
        [message(3, T + 4, { inputTokens: 1, outputTokens: 1, totalTokens: 2 })]
      )
    });
    const whole = await recordsOf(platform, path, { final: true });
    expect(whole).toHaveLength(4);
    for (let stop = 1; stop <= whole.length; stop++) {
      const stream = dshUsageDecoder.decode(platform, { path }, { final: true });
      const head: Item[] = [];
      for await (const item of stream) {
        head.push(item);
        if (head.length >= stop) {
          break;
        }
      }
      const tail = await readAll(platform, path, stream.cursor ? { from: stream.cursor, final: true } : {});
      expect([...head, ...tail.items]).toEqual(whole);
      // A stop inside the first batch frame leaves the frame's remaining records in the queue.
      if (stop < 3) {
        expect(stream.cursor?.queue?.map((record) => record.requestId)).toEqual(
          ["0", "1", "2"].slice(stop).map(String)
        );
      }
    }
  });

  it("drops the cursor when a frame fails mid-way, so the next decode does not replay it", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/mixed-11/session.v4.jsonl.zstd";
    const { platform } = decompressing({
      [path]: zstdFile(
        [header("dsh-mixed-11")],
        [message(0, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }), header("dsh-mixed-11", { version: 3 })]
      )
    });
    const first = await readAll(platform, path, { final: true });
    expect(first.items.map(failTag)).toEqual(["record", "UnknownFormatGeneration"]);
    expect(first.cursor).toBeUndefined();
    const second = await readAll(platform, path, first.cursor ? { from: first.cursor, final: true } : { final: true });
    expect(second.items.map(failTag)).toEqual(["record", "UnknownFormatGeneration"]);
  });

  it("drops the cursor before draining when a frame fails, so a mid-drain stop does not replay with wrong lines", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/mixed-12/session.v4.jsonl.zstd";
    const { platform } = decompressing({
      [path]: zstdFile(
        [header("dsh-mixed-12")],
        [
          message(0, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
          message(1, T + 2, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
          header("dsh-mixed-12", { version: 3 })
        ]
      )
    });
    const whole = await readAll(platform, path, { final: true });
    expect(whole.items.map(failTag)).toEqual(["record", "record", "UnknownFormatGeneration"]);
    const stream = dshUsageDecoder.decode(platform, { path }, { final: true });
    const head: Item[] = [];
    for await (const item of stream) {
      head.push(item);
      if (head.length >= 1) {
        break;
      }
    }
    // The failure comes from the same frame's queue: a consumer stopping mid-drain must already see no cursor.
    expect(stream.cursor).toBeUndefined();
    const resumed = await readAll(
      platform,
      path,
      stream.cursor ? { from: stream.cursor, final: true } : { final: true }
    );
    expect(
      resumed.items.map((item) => (isUsageRecord(item) ? [item.requestId, item.source.line] : item.error._tag))
    ).toEqual([["0", 2], ["1", 3], "UnknownFormatGeneration"]);
  });

  it("counts no request for a compaction/prune, which records no model call", async () => {
    const path = "/u/me/.dsh/sessions/-u-me-work-/prune-13/session.v4.jsonl";
    const { platform } = decompressing({
      [path]: `${[
        header("dsh-prune-13"),
        message(0, T + 1, { inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        event("compaction/prune", 1, T + 2, {
          shadowedRange: { start: 0, end: 0 },
          shadowedSeqs: [0],
          shadowedTokenCount: 5,
          usage: { inputTokens: 100, outputTokens: 7 }
        })
      ].join("\n")}\n`
    });
    const records = await recordsOf(platform, path, { final: true });
    expect(records.map((record) => record.requestId)).toEqual(["0"]);
    const summary = await dshSessionAdapter.summarize?.(platform, { agent: "dsh", path }, {});
    expect(summary).toBeDefined();
    if (summary === undefined) {
      return;
    }
    expect(summary.ok).toBe(true);
    if (!summary.ok) {
      return;
    }
    expect(summary.value.requests).toBe(1);
    expect(summary.value.inputTokens).toBe(1);
  });

  it("reports SourceChanged and drops the cursor when the file was shrunk or rewritten", async () => {
    const full = zstdFile(...seededBatches);
    const { memory, platform } = decompressing({ [seededPath]: full });
    const { cursor } = await readAll(platform, seededPath, { final: true });
    expect(cursor).toBeDefined();
    // Shrink below the cursor.
    await memory.fs.writeAtomic(seededPath, new Uint8Array(frame([header("dsh-seeded-2")])));
    const afterShrink = await readAll(platform, seededPath, cursor ? { from: cursor } : {});
    expect(afterShrink.items).toEqual([
      {
        agent: "dsh",
        path: seededPath,
        error: {
          _tag: "SourceChanged",
          source: { file: seededPath, offset: cursor?.offset, length: 0, line: cursor?.line }
        }
      }
    ]);
    expect(afterShrink.cursor).toBeUndefined();
    // Rewrite with bytes that are not a frame at the cursor.
    await memory.fs.writeAtomic(seededPath, "x".repeat(full.byteLength + 20));
    const afterGarbage = await readAll(platform, seededPath, cursor ? { from: cursor } : {});
    expect(afterGarbage.items.map(failTag)).toEqual(["SourceChanged"]);
    expect(afterGarbage.cursor).toBeUndefined();
  });

  it("reports ReadFailed when the host cannot decompress, without throwing", async () => {
    const memory = createMemoryPlatform({ files: { [seededPath]: zstdFile(...seededBatches) } });
    const platform: UsagePlatform = { fs: memory.fs };
    const { items, cursor } = await readAll(platform, seededPath, { final: true });
    expect(items.map(failTag)).toEqual(["ReadFailed"]);
    // Only SourceChanged drops the cursor; a ReadFailed keeps the last position, as the JSONL reader does.
    expect(cursor).toMatchObject({ agent: "dsh", offset: 0, line: 0 });
  });

  it("lists only the latest generation and names a source by its id directory and file", async () => {
    const files = {
      "/u/me/.dsh/sessions/-u-me-work-/old/session.v3.jsonl": `${plainLines[0]}\n`,
      "/u/me/.dsh/sessions/-u-me-work-/old/session.v4.jsonl": `${plainLines.join("\n")}\n`,
      "/u/me/.dsh/sessions/-u-me-work-/new/session.v4.jsonl.zstd": zstdFile(
        [header("dsh-new-5")],
        [{ type: "session/title", seq: 1, time: T + 1, data: { title: "x" } }].map((value) => JSON.stringify(value))
      )
    };
    const { platform } = decompressing(files);
    const home = homeFromRule("dsh", dsh.home, { home: "/u/me", env: {} });
    const listed: { id: string; path: string }[] = [];
    for await (const source of dshUsageDecoder.sources(platform, home)) {
      if ("error" in source) {
        throw new Error(`${source.path}: ${JSON.stringify(source.error)}`);
      }
      listed.push({ id: source.id, path: source.path });
    }
    expect(listed).toEqual([
      { id: "new/session.v4.jsonl.zstd", path: "/u/me/.dsh/sessions/-u-me-work-/new/session.v4.jsonl.zstd" },
      { id: "old/session.v4.jsonl", path: "/u/me/.dsh/sessions/-u-me-work-/old/session.v4.jsonl" }
    ]);
  });

  it("names a source by its id directory and file, so the id is the same in another project directory", async () => {
    const id = async (cwd: string): Promise<string | undefined> => {
      const { platform } = decompressing({ [`/u/me/.dsh/sessions/${cwd}/s-1/session.v4.jsonl`]: `${plainLines[0]}\n` });
      const home = homeFromRule("dsh", dsh.home, { home: "/u/me", env: {} });
      for await (const source of dshUsageDecoder.sources(platform, home)) {
        return "error" in source ? undefined : source.id;
      }
      return undefined;
    };
    expect(await id("-u-me-work-")).toBe("s-1/session.v4.jsonl");
    expect(await id("-u-me-other-")).toBe("s-1/session.v4.jsonl");
  });
});
