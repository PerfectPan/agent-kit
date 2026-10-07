import { builtinHookDialects, type HookDialect } from "@rivus/agent-kit-harness";
import { describe, expect, it } from "vitest";

import { hookDialectConformance } from "../src/hook-dialect-conformance.js";
import { cursorSamples } from "./fixtures/hooks/cursor.js";

// Each broken dialect differs from the Cursor one in a single way; the named check must reject it.

const cursor = builtinHookDialects.cursor;

async function failure(dialect: HookDialect, name: string, samples = cursorSamples): Promise<string> {
  const check = hookDialectConformance(dialect, { samples }).find((candidate) => candidate.name === name);
  expect(check).toBeDefined();
  try {
    await check!.run();
  } catch (error) {
    return (error as Error).message;
  }
  return "passed";
}

function withEvent(name: string, spec: HookDialect["events"][string]): HookDialect {
  return { ...cursor, events: { ...cursor.events, [name]: spec } };
}

describe("hookDialectConformance", () => {
  it("rejects a command dialect without a timeout unit", async () => {
    const name = "declares harness-v1 and how its hooks are delivered";
    expect(await failure(cursor, name)).toBe("passed");
    const { timeout: _timeout, ...untimed } = cursor;
    expect(await failure(untimed, name)).toMatch(/timeout unit/);
  });

  it("rejects an event mapped to phase unknown unless it is a gate", async () => {
    const name = "maps every event to a phase";
    expect(await failure(cursor, name)).toBe("passed");
    expect(await failure(withEvent("stop", { lifecycle: { phase: "unknown" } }), name)).toMatch(/stop: phase unknown/);
    expect(await failure(withEvent("stop", { lifecycle: { phase: "activity", outcome: "completed" } }), name)).toMatch(
      /outcome completed on phase activity/
    );
  });

  it("rejects a gate without its own response format", async () => {
    const name = "declares a response format for every gate event and every output rule";
    expect(await failure(cursor, name)).toBe("passed");
    expect(await failure(withEvent("preToolUse", { lifecycle: { phase: "activity" }, gate: true }), name)).toMatch(
      /preToolUse is a gate/
    );
    const allows = { ...cursor.events.preToolUse!.output!, passThrough: '{"permission":"allow","x":1}' };
    expect(
      await failure(withEvent("preToolUse", { lifecycle: { phase: "activity" }, gate: true, output: allows }), name)
    ).toMatch(/fields the event does not accept: x/);
  });

  it("rejects a foreign rename onto an unmapped event", async () => {
    const name = "renames foreign events onto its own events";
    expect(await failure(cursor, name)).toBe("passed");
    const [claude] = cursor.runsHooksOf!;
    const broken = { ...cursor, runsHooksOf: [{ ...claude!, events: { Notification: "notification" } }] };
    expect(await failure(broken, name)).toMatch(/renames to unmapped event notification/);
  });

  it("rejects missing samples and samples that read differently", async () => {
    expect(await failure(cursor, "has a sample for every event", [])).toMatch(/no sample for sessionStart/);
    const [first] = cursorSamples;
    const wrong = [{ ...first!, expected: { ...first!.expected, phase: "finish" as const } }];
    expect(await failure(cursor, "reads every sample to the expected LifecycleEvent", wrong)).toMatch(/expected/);
  });

  it("reads probe payloads through the dialect", async () => {
    const name = "reads odd payloads as phase unknown without throwing";
    expect(await failure(cursor, name)).toBe("passed");
    expect(await failure(withEvent("no-such-event", { lifecycle: { phase: "activity" } }), name)).toMatch(
      /no-such-event/
    );
  });
});
