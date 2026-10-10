import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mergeByTime, timedRecord, translateCodexRecords } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

// The translated shape of every conformance fixture, pinned: a refactor of the Codex record dispatch may not change
// it silently. Regenerate the JSON only deliberately, with the differential harness against the previous algorithm.
const fixtures = fileURLToPath(new URL("fixtures/codex", import.meta.url));
const golden = JSON.parse(
  readFileSync(new URL("fixtures/codex/translate-golden.json", import.meta.url), "utf8")
) as Record<string, unknown>;

const serialize = (name: string, text: string) => {
  const records = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => {
      try {
        JSON.parse(line);
        return true;
      } catch {
        return false;
      }
    })
    .map((line, index) => ({ value: JSON.parse(line), file: `${name}.jsonl`, line: index + 1, offset: 0, length: 1 }));
  const translated = translateCodexRecords(mergeByTime([records.map(timedRecord)]), { path: `${name}.jsonl` });
  if (!translated.ok) {
    return { ok: false, error: translated.error };
  }
  const { events, skipped, session, agents, agentVersion } = translated.value;
  return {
    ok: true,
    session,
    agents,
    agentVersion,
    skipped,
    events: events.map((event) => ({
      id: event.id,
      seq: event.seq,
      ts: event.ts,
      kind: event.kind,
      agentId: event.agentId,
      parentId: event.parentId,
      requestId: event.requestId,
      shadowedBy: event.shadowedBy,
      payload: event.payload,
      source: event.source,
      original: event.original
    }))
  };
};

describe("codex translation golden", () => {
  for (const [name, expected] of Object.entries(golden)) {
    it(`translates ${name} exactly as pinned`, () => {
      const path =
        name === "unknown-generation"
          ? `${fixtures}/unknown-generation/rollout-bad.jsonl`
          : `${fixtures}/conformance/${name}.jsonl`;
      const text = readFileSync(path, "utf8");
      expect(serialize(name, text)).toEqual(expected);
    });
  }
});
