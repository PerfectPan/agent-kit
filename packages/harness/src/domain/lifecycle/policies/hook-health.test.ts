import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vite-plus/test";

import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import type { HookDialect } from "../value-objects/hook-dialect.js";
import { duplicateHooks, hookHealth, hookProgram, type HookProblem } from "./hook-health.js";

const at = (pointer: string, member = "~/bin/hook.sh"): ArtifactLocator => ({
  kind: "json-entry",
  path: "/u/me/.gemini/settings.json",
  pointer,
  member
});

const dialect = (
  events: Readonly<Record<string, readonly string[]>>,
  agent: CodingAgentId = "gemini-cli",
  unit: "seconds" | "milliseconds" = "milliseconds"
): HookDialect => ({
  specificationVersion: "harness-v1",
  agent,
  delivery: "command",
  timeout: { unit, default: unit === "milliseconds" ? 10000 : 10 },
  fields: { event: { paths: [["event"]] } },
  events: Object.fromEntries(
    Object.entries(events).map(([name, aliases]) => [
      name,
      { lifecycle: { phase: "start" as const }, ...(aliases.length === 0 ? {} : { aliases }) }
    ])
  )
});

describe("hookProgram", () => {
  it.each([
    ["npx demo-hook --event Stop", "npx"],
    ["  '/opt/hook' --flag ", "/opt/hook"],
    ['"~/bin/hook.sh"', "~/bin/hook.sh"],
    ["", ""]
  ])("%s → %s", (command, program) => {
    expect(hookProgram(command)).toBe(program);
  });
});

describe("hookHealth", () => {
  const gemini = dialect({ SessionStart: [], Stop: ["Stoped"] });

  it("flags an event the dialect does not know, by its own names and aliases only", () => {
    expect(hookHealth(gemini, at("/hooks/PreToolUse"), {}, () => true)).toEqual([
      {
        problem: "unknown-event",
        locator: at("/hooks/PreToolUse"),
        agent: "gemini-cli",
        event: "PreToolUse"
      }
    ]);
    expect(hookHealth(gemini, at("/hooks/SessionStart"), {}, () => true)).toEqual([]);
    expect(hookHealth(gemini, at("/hooks/Stoped"), {}, () => true)).toEqual([]);
  });

  it("reads a timeout below one second in a milliseconds dialect as the wrong unit", () => {
    const problems = (timeout: number | undefined): readonly HookProblem[] =>
      hookHealth(gemini, at("/hooks/Stop"), { timeout }, () => true).map(({ problem }) => problem);
    expect(problems(500)).toEqual(["timeout-unit"]);
    expect(hookHealth(gemini, at("/hooks/Stop"), { timeout: 500 }, () => true)).toEqual([
      { problem: "timeout-unit", locator: at("/hooks/Stop"), agent: "gemini-cli", timeout: 500 }
    ]);
    expect(problems(1000)).toEqual([]);
    expect(problems(undefined)).toEqual([]);
    expect(
      hookHealth(dialect({ Stop: [] }, "claude-code", "seconds"), at("/hooks/Stop"), { timeout: 5 }, () => true)
    ).toEqual([]);
  });

  it("flags a program by absolute path that does not exist, and nothing relative or present", () => {
    expect(hookHealth(gemini, at("/hooks/Stop", "/gone/bin/old-hook"), {}, () => false)).toEqual([
      {
        problem: "stale-path",
        locator: at("/hooks/Stop", "/gone/bin/old-hook"),
        program: "/gone/bin/old-hook"
      }
    ]);
    expect(hookHealth(gemini, at("/hooks/Stop", "/gone/bin/old-hook"), {}, () => true)).toEqual([]);
    expect(hookHealth(gemini, at("/hooks/Stop", "npx demo-hook"), {}, () => false)).toEqual([]);
  });
});

describe("duplicateHooks", () => {
  const first = at("/hooks/Stop", "npx demo-hook run --event Stop");
  const second = at("/hooks/Stop~1Deep", "npx demo-hook run --event Stop");
  const other = at("/hooks/Stop", "npx demo-hook run --extra --event Stop");
  const foreign = at("/hooks/SessionStart", "~/bin/notify.sh");
  const hooks = [
    { event: "Stop", command: first.member ?? "", locator: first },
    { event: "Stop", command: second.member ?? "", locator: second },
    { event: "Stop", command: other.member ?? "", locator: other },
    { event: "SessionStart", command: foreign.member ?? "", locator: foreign }
  ];

  it("flags the later of two equal commands for one event", () => {
    expect(duplicateHooks("grok", hooks, [])).toEqual([
      { problem: "duplicate-hook", locator: second, agent: "grok", event: "Stop" }
    ]);
  });

  it("flags more than one hook of one application, matching markers the way isLegacyArtifact does", () => {
    expect(duplicateHooks("grok", hooks, ["demo-hook run"])).toEqual([
      { problem: "duplicate-hook", locator: second, agent: "grok", event: "Stop" },
      { problem: "duplicate-hook", locator: other, agent: "grok", event: "Stop", markedCount: 3 }
    ]);
    // A marker that is only whitespace never matches, so no text holding a space becomes the application's.
    expect(duplicateHooks("grok", hooks, [" ", "\t"])).toEqual([
      { problem: "duplicate-hook", locator: second, agent: "grok", event: "Stop" }
    ]);
  });
});
