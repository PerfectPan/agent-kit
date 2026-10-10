import { describe, expect, it } from "vite-plus/test";

import type { SessionRef } from "../../../domain/session/index.js";
import type { SessionPlatform } from "../../ports.js";
import { grokSessionAdapter } from "./grok.js";

const encoder = new TextEncoder();

const ref: SessionRef = { agent: "grok", path: "/s/updates.jsonl" };

const update = (body: Record<string, unknown>, timestamp = 1767225600): string =>
  `${JSON.stringify({ method: "session/update", params: { update: body }, timestamp })}\n`;

const files = (updates: string, summary = '{"chat_format_version":1,"info":{"id":"s"}}'): Record<string, string> => ({
  "/s/updates.jsonl": updates,
  "/s/summary.json": summary,
  "/s/subagents/w-9/meta.json": '{"subagent_id":"worker","description":"Dig"}'
});

/** A platform whose sessions are the given files and whose `read` records which iterators were closed. */
function fakeGrok(
  fileSet: Record<string, string>,
  abort?: { path: string; afterBytes: number }
): {
  platform: SessionPlatform;
  closed: string[];
  signal: AbortSignal;
} {
  const closed: string[] = [];
  const controller = new AbortController();
  const platform: SessionPlatform = {
    fs: {
      async stat(path) {
        if (fileSet[path] !== undefined) {
          return { kind: "file", size: encoder.encode(fileSet[path]!).byteLength, mtimeMs: 7 };
        }
        const below = Object.keys(fileSet).some((file) => file.startsWith(`${path}/`));
        return below ? { kind: "dir", size: 0, mtimeMs: 7 } : undefined;
      },
      async list(dir) {
        const entries = new Map<string, "dir" | "file">();
        for (const file of Object.keys(fileSet)) {
          if (!file.startsWith(`${dir}/`)) {
            continue;
          }
          const rest = file.slice(dir.length + 1);
          const slash = rest.indexOf("/");
          entries.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? "file" : "dir");
        }
        return [...entries].map(([name, kind]) => ({ name, kind }));
      },
      async *read(path) {
        const text = fileSet[path];
        if (text === undefined) {
          throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
        }
        const bytes = encoder.encode(text);
        const split = abort?.path === path ? Math.min(abort.afterBytes, bytes.byteLength) : bytes.byteLength;
        try {
          yield bytes.slice(0, split);
          if (abort?.path === path) {
            controller.abort();
          }
          if (split < bytes.byteLength) {
            yield bytes.slice(split);
          }
        } finally {
          closed.push(path);
        }
      }
    }
  };
  return { platform, closed, signal: controller.signal };
}

describe("grokSessionAdapter.summarize", () => {
  it("closes every reader when a record is an unknown format generation", async () => {
    const fake = fakeGrok(files(update({ sessionUpdate: "user_message_chunk", schema_version: 2 })));
    const summarized = await grokSessionAdapter.summarize!(fake.platform, ref);
    expect(summarized.ok).toBe(false);
    if (!summarized.ok) {
      expect(summarized.error._tag).toBe("UnknownFormatGeneration");
    }
    expect([...fake.closed].toSorted()).toStrictEqual(
      ["/s/subagents/w-9/meta.json", "/s/summary.json", "/s/updates.jsonl"].toSorted()
    );
  });

  it("closes the reader when the read is aborted mid-file", async () => {
    const updates = [
      update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "one" } }),
      update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "two" } }),
      update({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "three" } })
    ].join("");
    const fake = fakeGrok(files(updates), { path: "/s/updates.jsonl", afterBytes: updates.indexOf("\n") + 1 });
    const rejection = await grokSessionAdapter.summarize!(fake.platform, ref, { signal: fake.signal }).then(
      (): unknown => undefined,
      (error: unknown): unknown => error
    );
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe("AbortError");
    expect([...fake.closed].toSorted()).toStrictEqual(
      ["/s/subagents/w-9/meta.json", "/s/summary.json", "/s/updates.jsonl"].toSorted()
    );
  });

  it("fails like the load with a summary.json of another generation, and opens no reader for the updates", async () => {
    const fake = fakeGrok(files(update({ sessionUpdate: "user_message_chunk" }), '{"chat_format_version":2}'));
    const summarized = await grokSessionAdapter.summarize!(fake.platform, ref);
    expect(summarized.ok).toBe(false);
    if (!summarized.ok) {
      expect(summarized.error._tag).toBe("UnknownFormatGeneration");
      expect(summarized.error).toMatchObject({ file: "/s/summary.json", line: 1 });
    }
    expect([...fake.closed].toSorted()).toStrictEqual(["/s/summary.json"]);
    const loaded = await grokSessionAdapter.load(fake.platform, ref);
    expect(summarized).toEqual(loaded);
  });
});
