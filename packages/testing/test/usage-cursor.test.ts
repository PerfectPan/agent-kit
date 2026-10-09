import { type CodingAgentId, isAgentKitError } from "@rivus/agent-kit-catalog";
import {
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  type UsageCursor,
  type UsageDecodeFailure,
  type UsagePlatform,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { readUsageHome } from "./support.js";

const tree = await readUsageHome("/u/me");
const text = (path: string): string => new TextDecoder().decode(tree[path]);

const FILES: readonly [CodingAgentId, string][] = [
  ["claude-code", "/u/me/.claude/projects/-u-me-work/s-usage.jsonl"],
  ["codex", "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-totals.jsonl"],
  ["codex", "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-10-00-cx-fork.jsonl"],
  ["gemini-cli", "/u/me/.gemini/tmp/projhash/chats/session-2026-01-01T00-00-gm1.jsonl"],
  ["gemini-cli", "/u/me/.gemini/tmp/projhash/chats/session-legacy.json"],
  ["grok", "/u/me/.grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl"],
  ["pi", "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-02T00-00-00-000Z_pi-fork.jsonl"],
  ["opencode", "/u/me/.local/share/opencode/storage/message/ses_legacy"]
];

type Item = UsageRecord | UsageDecodeFailure;

/** Decodes `path`, leaving the loop after `stop` items; the cursor goes through JSON, as a caller would store it. */
async function decode(
  platform: UsagePlatform,
  agent: CodingAgentId,
  path: string,
  options: DecodeUsageOptions & { stop?: number } = {}
): Promise<{ items: Item[]; cursor: UsageCursor | undefined }> {
  const { stop, ...decodeOptions } = options;
  const stream = decodeUsage(platform, agent, { path }, decodeOptions);
  const items: Item[] = [];
  for await (const item of stream) {
    items.push(item);
    if (items.length === stop) {
      break;
    }
  }
  const cursor = stream.cursor === undefined ? undefined : (JSON.parse(JSON.stringify(stream.cursor)) as UsageCursor);
  return { items, cursor };
}

const ids = (items: readonly Item[]) =>
  items.map((item) => (isUsageRecord(item) ? (item.responseId ?? item.requestId ?? item.timestamp) : item.error._tag));

describe("decodeUsage cursors", () => {
  it.each(FILES)(
    "%s: leaving the loop after any record and continuing from the cursor yields the same records",
    async (agent, path) => {
      const platform = createMemoryPlatform({ files: tree, home: "/u/me", chunkSize: 61 });
      const whole = await decode(platform, agent, path, { final: true });
      expect(whole.items.length).toBeGreaterThan(0);
      for (let stop = 1; stop <= whole.items.length; stop++) {
        const head = await decode(platform, agent, path, { stop, final: true });
        const rest = await decode(platform, agent, path, {
          ...(head.cursor ? { from: head.cursor } : {}),
          final: true
        });
        expect([...head.items, ...rest.items]).toEqual(whole.items);
        expect(rest.cursor).toEqual(whole.cursor);
      }
    }
  );

  it("stops at the first record at or after `until`, and the cursor continues with it", async () => {
    const [agent, path] = FILES[1]!;
    const platform = createMemoryPlatform({ files: tree });
    const whole = await decode(platform, agent, path, { final: true });
    const until = Date.parse("2026-01-01T00:00:03.000Z");
    const head = await decode(platform, agent, path, { until, final: true });
    expect(head.items).toHaveLength(2);
    expect(head.items.every((item) => isUsageRecord(item) && item.timestamp < until)).toBe(true);
    const rest = await decode(platform, agent, path, {
      ...(head.cursor ? { from: head.cursor } : {}),
      final: true
    });
    expect([...head.items, ...rest.items]).toEqual(whole.items);
  });

  it("stops before a last line that is still being written, and reads it once it is complete", async () => {
    const path = "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl";
    const full = text(path);
    const lineStart = full.lastIndexOf("\n", full.length - 2) + 1;
    const platform = createMemoryPlatform({ files: { [path]: full.slice(0, lineStart + 20) } });
    const first = await decode(platform, "pi", path);
    expect(first.items).toHaveLength(1);
    expect(first.cursor?.offset).toBe(lineStart);
    await platform.fs.writeAtomic(path, full);
    const next = await decode(platform, "pi", path, first.cursor ? { from: first.cursor } : {});
    expect(ids(next.items)).toEqual(["resp-pi-2"]);
  });

  it("keeps a torn last line for the next decode even when the file is final", async () => {
    const path = "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl";
    const full = text(path);
    const lineStart = full.lastIndexOf("\n", full.length - 2) + 1;
    const platform = createMemoryPlatform({ files: { [path]: full.slice(0, lineStart + 20) } });
    const first = await decode(platform, "pi", path, { final: true });
    expect(first.cursor?.offset).toBe(lineStart);
    await platform.fs.writeAtomic(path, full);
    const next = await decode(platform, "pi", path, {
      ...(first.cursor ? { from: first.cursor } : {}),
      final: true
    });
    expect(ids(next.items)).toEqual(["resp-pi-2"]);
  });

  it("returns SourceChanged for a file rewritten shorter, without a cursor, so the next decode reads it again", async () => {
    const [agent, path] = FILES[0]!;
    const platform = createMemoryPlatform({ files: tree });
    const { cursor } = await decode(platform, agent, path, { final: true });
    await platform.fs.writeAtomic(path, text(path).slice(0, 100));
    const changed = await decode(platform, agent, path, cursor ? { from: cursor } : {});
    expect(changed.items).toEqual([
      {
        agent,
        path,
        error: {
          _tag: "SourceChanged",
          source: { file: path, offset: cursor?.offset, length: 0, line: cursor?.line }
        }
      }
    ]);
    expect(changed.cursor).toBeUndefined();
  });

  it("throws for a cursor of another agent", async () => {
    const platform = createMemoryPlatform({ files: tree });
    const { cursor } = await decode(platform, ...FILES[1]!);
    let thrown: unknown;
    try {
      decodeUsage(platform, "claude-code", { path: FILES[0]![1] }, cursor ? { from: cursor } : {});
    } catch (error) {
      thrown = error;
    }
    expect(isAgentKitError(thrown) && thrown.code).toBe("invalid-cursor");
  });
});

describe("decodeUsage reads", () => {
  it("streams: leaving the loop after the first record stops reading a large file", async () => {
    const line = (index: number) =>
      JSON.stringify({
        type: "assistant",
        requestId: `req-${index}`,
        timestamp: "2026-01-01T00:00:00.000Z",
        message: {
          id: `msg-${index}`,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: "x".repeat(200)
        }
      });
    const path = "/u/me/.claude/projects/big/session.jsonl";
    const base = createMemoryPlatform({
      files: { [path]: `${Array.from({ length: 5000 }, (_, index) => line(index)).join("\n")}\n` },
      chunkSize: 4096
    });
    let pulled = 0;
    const platform: UsagePlatform = {
      fs: {
        ...base.fs,
        async *read(target, range) {
          for await (const chunk of base.fs.read(target, range)) {
            pulled += 1;
            yield chunk;
          }
        }
      }
    };
    const { items } = await decode(platform, "claude-code", path, { stop: 1 });
    expect(items).toHaveLength(1);
    expect(pulled).toBeLessThan(5);
  });

  it("rejects with the signal's reason once aborted", async () => {
    const platform = createMemoryPlatform({ files: tree });
    const controller = new AbortController();
    const [agent, path] = FILES[1]!;
    const consume = async () => {
      for await (const _item of decodeUsage(platform, agent, { path }, { signal: controller.signal })) {
        controller.abort(new Error("stop"));
      }
    };
    await expect(consume()).rejects.toThrow("stop");
  });

  it("returns expected failures as items: an unreadable file, a missing one, an unknown agent or generation", async () => {
    const base = createMemoryPlatform({
      files: {
        ...tree,
        "/u/me/bad.jsonl": `${text(FILES[0]![1]).split("\n").slice(0, 2).join("\n")}\n{"type":"assistant","formatVersion":2}\n`
      }
    });
    const denied: UsagePlatform = {
      fs: {
        ...base.fs,
        // oxlint-disable-next-line require-yield -- an iterator that fails on its first pull, like an unreadable file
        async *read() {
          throw Object.assign(new Error("EACCES: denied"), { code: "EACCES" });
        }
      }
    };
    const tags = async (platform: UsagePlatform, agent: CodingAgentId, path: string) =>
      (await decode(platform, agent, path, { final: true })).items.map((item) =>
        isUsageRecord(item) ? "record" : item.error._tag
      );
    expect(await tags(denied, ...FILES[1]!)).toEqual(["ReadFailed"]);
    expect(await tags(base, "codex", "/u/me/missing.jsonl")).toEqual(["SessionNotFound"]);
    expect(await tags(base, "my-agent", "/u/me/x.jsonl")).toEqual(["CapabilityUnsupported"]);
    expect(await tags(base, "claude-code", "/u/me/bad.jsonl")).toEqual(["UnknownFormatGeneration"]);
  });
});
