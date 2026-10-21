import type { AgentHome } from "@rivus/agent-kit-catalog";
import {
  isUsageRecord,
  isUsageSource,
  type UsageDecoder,
  type UsagePlatform,
  type UsageRecord,
  type UsageStream
} from "@rivus/agent-kit-sessions";
import { isEqual } from "es-toolkit";

import { check, type ConformanceCheck } from "./session-adapter-conformance.js";

export interface UsageDecoderFixtures {
  readonly platform: UsagePlatform;
  readonly home: AgentHome;
  /** Complete sources and their expected record counts, including fork filtering. */
  readonly sources: readonly { readonly path: string; readonly records: number }[];
}

async function recordsOf(stream: UsageStream): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  for await (const item of stream) {
    check(isUsageRecord(item), "decode returned a failure for a fixture source");
    records.push(item);
  }
  return records;
}

/** Runner-agnostic checks of the usage SPI, kept internal until a public consumer needs this suite. */
export function usageDecoderConformance(decoder: UsageDecoder, fixtures: UsageDecoderFixtures): ConformanceCheck[] {
  const { platform, home, sources } = fixtures;
  return [
    {
      name: "lists exactly the fixture sources under its home",
      async run() {
        check(decoder.agent === home.agent, "decoder and home name different agents");
        const paths: string[] = [];
        for await (const item of decoder.sources(platform, home)) {
          check(isUsageSource(item), "sources returned a failure for the fixture home");
          check(item.agent === decoder.agent, "source names another agent");
          paths.push(item.path);
        }
        check(isEqual(paths.toSorted(), sources.map(({ path }) => path).toSorted()), "source paths differ");
      }
    },
    ...sources.flatMap(({ path, records }): ConformanceCheck[] => [
      {
        name: `decodes valid records and stable request keys: ${path}`,
        async run() {
          const first = await recordsOf(decoder.decode(platform, { path }, { final: true }));
          check(first.length === records, "decoded record count differs");
          check(
            first.every((record) => record.agent === decoder.agent),
            "record names another agent"
          );
          const second = await recordsOf(decoder.decode(platform, { path }, { final: true }));
          check(isEqual(first, second), "repeated decoding differs");
          check(
            isEqual(
              first.map((record) => decoder.usageKey(record)),
              second.map((record) => decoder.usageKey(record))
            ),
            "request keys differ"
          );
        }
      },
      {
        name: `resumes a complete source without replaying records: ${path}`,
        async run() {
          const stream = decoder.decode(platform, { path }, { final: true });
          await recordsOf(stream);
          check(stream.cursor !== undefined, "complete decode returned no cursor");
          const resumed = await recordsOf(decoder.decode(platform, { path }, { from: stream.cursor, final: true }));
          check(resumed.length === 0, "cursor replayed completed records");
        }
      }
    ])
  ];
}
