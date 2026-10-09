import { describe, expect, it } from "vitest";

import { isWithin, locatorKey, locatorProblem, locatorsOverlap, pointerTail } from "./artifact-locator.js";
import type { ArtifactLocator } from "./artifact-locator.js";

describe("artifact locators", () => {
  it("accepts absolute normalized paths with the pointer their kind needs", () => {
    expect(locatorProblem({ kind: "file", path: "/u/me/.claude/skills/x/SKILL.md" })).toBeUndefined();
    expect(locatorProblem({ kind: "dir", path: "C:\\Users\\me\\.codex\\plugins\\x" })).toBeUndefined();
    expect(
      locatorProblem({ kind: "json-entry", path: "/u/me/.claude/settings.json", pointer: "/hooks/Stop", member: "x" })
    ).toBeUndefined();
    expect(locatorProblem({ kind: "managed-block", path: "/p/AGENTS.md", pointer: "presence" })).toBeUndefined();
  });

  it.each([
    [{ kind: "file", path: "relative/x" }, "path is not absolute and normalized"],
    [{ kind: "file", path: "/u/me/../x" }, "path is not absolute and normalized"],
    [{ kind: "file", path: "/u/me//x" }, "path is not absolute and normalized"],
    [{ kind: "file", path: "/u/me/x/" }, "path is not absolute and normalized"],
    [{ kind: "file", path: "/" }, "path is not absolute and normalized"],
    [{ kind: "file", path: "/x", pointer: "/a" }, "file takes no pointer"],
    [{ kind: "json-entry", path: "/x" }, "json-entry needs a pointer"],
    [{ kind: "toml-entry", path: "/x", pointer: "hooks.Stop" }, "pointer is not a JSON pointer to an entry"],
    [{ kind: "managed-block", path: "/x", pointer: "" }, "pointer is empty"],
    [
      { kind: "json-entry", path: "/x", pointer: "/hooks/Stop/1/hooks/0" },
      "pointer names an array index; address the element by `member`"
    ],
    [
      { kind: "toml-entry", path: "/x", pointer: "/hooks/Stop/-" },
      "pointer names an array index; address the element by `member`"
    ],
    [{ kind: "json-entry", path: "/x", pointer: "/hooks/Stop", member: "" }, "member is empty"],
    [{ kind: "file", path: "/x", member: "a" }, "file takes no member"],
    [{ kind: "json-entry", path: "/x", pointer: "/hooks/Stop", memberIn: "hook-group" }, "memberIn without a member"]
  ] as const)("rejects %o", (locator, problem) => {
    expect(locatorProblem(locator)).toBe(problem);
  });

  it("reads a null pointer as absent instead of throwing", () => {
    const locator = { kind: "json-entry", path: "/x", pointer: null } as unknown as ArtifactLocator;
    expect(locatorProblem(locator)).toBe("pointer is not a JSON pointer to an entry");
    expect(pointerTail(locator.pointer)).toBeUndefined();
  });

  it("accepts a hook nested in an event's groups, keyed like any member, and object keys the kit writes", () => {
    const hook = {
      kind: "json-entry",
      path: "/x",
      pointer: "/hooks/Stop",
      member: "/u/me/bin/shim Stop",
      memberIn: "hook-group"
    } as const;
    expect(locatorProblem(hook)).toBeUndefined();
    expect(locatorKey(hook)).toBe(JSON.stringify(["/x", "/hooks/Stop", "/u/me/bin/shim Stop"]));
    expect(locatorProblem({ kind: "json-entry", path: "/x", pointer: "/mcpServers/presence_2048" })).toBeUndefined();
  });

  it("identifies an array element by its member, so the user's edits around it do not change its key", () => {
    const ours = { kind: "json-entry", path: "/x", pointer: "/hooks/Stop", member: "/u/me/bin/shim Stop" } as const;
    const theirs = { ...ours, member: "~/bin/notify.sh" };
    expect(locatorKey(ours)).toBe(JSON.stringify(["/x", "/hooks/Stop", "/u/me/bin/shim Stop"]));
    expect(locatorKey(ours)).not.toBe(locatorKey(theirs));
    expect(locatorKey(ours)).not.toBe(locatorKey({ kind: "json-entry", path: "/x", pointer: "/hooks/Stop" }));
  });

  it("keys a locator by path and pointer, not by kind", () => {
    expect(locatorKey({ kind: "file", path: "/x" })).toBe(locatorKey({ kind: "dir", path: "/x" }));
    expect(locatorKey({ kind: "json-entry", path: "/x#a", pointer: "/b" })).not.toBe(
      locatorKey({ kind: "json-entry", path: "/x", pointer: "a#/b" })
    );
  });

  it("checks containment by whole segments", () => {
    expect(isWithin("/u/me/.claude/skills/x", "/u/me/.claude")).toBe(true);
    expect(isWithin("/u/me/.claude", "/u/me/.claude")).toBe(true);
    expect(isWithin("/u/me/.claude-other/x", "/u/me/.claude")).toBe(false);
    expect(isWithin("/u/me/../etc/x", "/u/me")).toBe(false);
  });

  it("finds overlapping locators: the whole file and its entries, nested pointers, nested paths", () => {
    const settings = "/u/me/.claude/settings.json";
    expect(
      locatorsOverlap({ kind: "file", path: settings }, { kind: "json-entry", path: settings, pointer: "/hooks" })
    ).toBe(true);
    const hook = (member?: string) =>
      ({
        kind: "json-entry",
        path: settings,
        pointer: "/hooks/Stop",
        ...(member === undefined ? {} : { member })
      }) as const;
    expect(locatorsOverlap({ kind: "json-entry", path: settings, pointer: "/hooks" }, hook("a"))).toBe(true);
    expect(locatorsOverlap(hook(), hook("a"))).toBe(true);
    expect(locatorsOverlap(hook("a"), hook("a"))).toBe(true);
    expect(locatorsOverlap(hook("a"), hook("b"))).toBe(false);
    expect(
      locatorsOverlap(
        { kind: "dir", path: "/u/me/.claude/skills/x" },
        { kind: "file", path: "/u/me/.claude/skills/x/a.md" }
      )
    ).toBe(true);
    expect(
      locatorsOverlap({ kind: "dir", path: "/u/me/.claude/skills/x" }, { kind: "dir", path: "/u/me/.claude/skills/xy" })
    ).toBe(false);
  });
});
