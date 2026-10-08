import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vitest";

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
    expect(hookHealth(gemini, at("/hooks/PreToolUse"), {}, () => true).map(({ name }) => name)).toEqual([
      "unknown-event"
    ]);
    expect(hookHealth(gemini, at("/hooks/SessionStart"), {}, () => true)).toEqual([]);
    expect(hookHealth(gemini, at("/hooks/Stoped"), {}, () => true)).toEqual([]);
  });

  it("reads a timeout below one second in a milliseconds dialect as the wrong unit", () => {
    const finding = (timeout: unknown): HookProblem | undefined =>
      hookHealth(gemini, at("/hooks/Stop"), { timeout }, () => true).find(({ name }) => name === "timeout-unit")?.name;
    expect(finding(500)).toBe("timeout-unit");
    expect(finding(1000)).toBeUndefined();
    expect(finding("5")).toBeUndefined();
    expect(
      hookHealth(dialect({ Stop: [] }, "claude-code", "seconds"), at("/hooks/Stop"), { timeout: 5 }, () => true)
    ).toEqual([]);
  });

  it("flags a program by absolute path that does not exist, and nothing relative or present", () => {
    expect(
      hookHealth(gemini, at("/hooks/Stop", "/gone/bin/old-hook"), {}, () => false).map(({ name }) => name)
    ).toEqual(["stale-path"]);
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
    expect(duplicateHooks("grok", hooks, []).map(({ message, locator }) => [message, locator.pointer])).toEqual([
      ["grok runs this hook twice for Stop", "/hooks/Stop~1Deep"]
    ]);
  });

  it("flags more than one hook of one application, matching markers the way isLegacyArtifact does", () => {
    expect(duplicateHooks("grok", hooks, ["demo-hook run"]).map(({ message }) => message)).toEqual([
      "grok runs this hook twice for Stop",
      "grok runs 3 hooks of one application for Stop"
    ]);
    // A marker that is only whitespace never matches, so no text holding a space becomes the application's.
    expect(duplicateHooks("grok", hooks, [" ", "\t"]).map(({ message }) => message)).toEqual([
      "grok runs this hook twice for Stop"
    ]);
  });
});
