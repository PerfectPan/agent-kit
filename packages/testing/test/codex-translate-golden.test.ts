import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { mergeByTime, timedRecord, translateCodexRecords } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

// The translated shape of every conformance fixture and of the corners rollout, pinned: a refactor of the Codex
// record dispatch may not change it silently. The corners rollout lives outside the conformance directory because it
// pins an id collision the conformance suite's uniqueness rule would reject. To regenerate deliberately after an
// accepted shape change, run this file with UPDATE_GOLDEN set — `vp test test/codex-translate-golden.test.ts` with
// the variable in the environment rewrites the JSON from the current translation — and review the file's diff as
// part of the change.
const fixtures = fileURLToPath(new URL("fixtures/codex", import.meta.url));
const goldenPath = new URL("fixtures/codex/translate-golden.json", import.meta.url);
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Record<string, unknown>;

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

const translateAll = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(golden)) {
    const path =
      name === "unknown-generation"
        ? `${fixtures}/unknown-generation/rollout-bad.jsonl`
        : name === "rollout-corners"
          ? `${fixtures}/corners/rollout-corners.jsonl`
          : `${fixtures}/conformance/${name}.jsonl`;
    out[name] = serialize(name, readFileSync(path, "utf8"));
  }
  return out;
};

describe("codex translation golden", () => {
  it("translates every pinned fixture exactly as recorded", () => {
    const actual = translateAll();
    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(goldenPath, `${JSON.stringify(actual, null, 1)}\n`);
      return;
    }
    expect(actual).toEqual(golden);
  });
});
