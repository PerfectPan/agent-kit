import { describe, expect, it } from "vite-plus/test";

import type { PermissionRequest } from "../value-objects/permission-request.js";
import { agentEnv } from "./agent-env.js";
import {
  type AbsolutePath,
  clientPathVerdict,
  formatAbsolutePath,
  isWithin,
  parseAbsolutePath
} from "./client-paths.js";
import { optionOfKind, permissionOutcome } from "./permission-default.js";
import { firstPromptBlocks, sessionMeta } from "./session-setup.js";

const request = (kinds: PermissionRequest["options"][number]["kind"][]): PermissionRequest => ({
  sessionId: "s1",
  toolCall: { callId: "c1" },
  options: kinds.map((kind) => ({ optionId: kind, name: kind, kind }))
});

describe("permissionOutcome", () => {
  it("denies without a decision: the reject option, else cancelled", () => {
    expect(permissionOutcome(request(["allow_once", "reject_once"]), undefined, false)).toEqual({
      outcome: "selected",
      optionId: "reject_once"
    });
    expect(permissionOutcome(request(["allow_once", "reject_always"]), undefined, false)).toEqual({
      outcome: "selected",
      optionId: "reject_always"
    });
    expect(permissionOutcome(request(["allow_once"]), undefined, false)).toEqual({ outcome: "cancelled" });
  });

  it("accepts only an option the request offered, and answers cancelled while cancelling", () => {
    const offered = request(["allow_once", "reject_once"]);
    expect(permissionOutcome(offered, optionOfKind(offered, "allow_once"), false)).toEqual({
      outcome: "selected",
      optionId: "allow_once"
    });
    expect(permissionOutcome(offered, { optionId: "invented" }, false)).toEqual({
      outcome: "selected",
      optionId: "reject_once"
    });
    expect(permissionOutcome(offered, optionOfKind(offered, "allow_once"), true)).toEqual({ outcome: "cancelled" });
    expect(optionOfKind(offered, "allow_always")).toBeUndefined();
  });
});

describe("session setup", () => {
  it("puts the system prompt in _meta or before the first prompt", () => {
    const meta = { systemPrompt: { in: "meta", key: "rules" } } as const;
    const block = { systemPrompt: { in: "first-block" } } as const;
    const setup = { systemPrompt: "be brief", meta: { extra: 1 } };
    expect(sessionMeta(meta, setup)).toEqual({ extra: 1, rules: "be brief" });
    expect(sessionMeta(block, setup)).toEqual({ extra: 1 });
    expect(sessionMeta(block, {})).toBeUndefined();
    const blocks = [{ type: "text", text: "hi" }] as const;
    expect(firstPromptBlocks(block, blocks, setup)).toEqual([{ type: "text", text: "be brief" }, ...blocks]);
    expect(firstPromptBlocks(meta, blocks, setup)).toEqual(blocks);
  });
});

describe("agentEnv", () => {
  it("copies the variables a profile lists by name or pattern", () => {
    const profile = { env: ["PATH", "ANTHROPIC_*", "*_API_KEY"] };
    expect(
      agentEnv(profile, {
        PATH: "/bin",
        ANTHROPIC_API_KEY: "a",
        OPENAI_API_KEY: "o",
        HOME: "/u/me",
        GH_TOKEN: "t",
        EMPTY: undefined
      })
    ).toEqual({ PATH: "/bin", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" });
  });
});

describe("client paths", () => {
  it("keeps .. for the platform to resolve and compares resolved paths by parts", () => {
    const root = parseAbsolutePath("/work/project");
    const inside = parseAbsolutePath("/work/project/./src//a.txt");
    const unresolved = parseAbsolutePath("/work/project/src/../a.txt");
    const prefix = parseAbsolutePath("/work/project-2/a.txt");
    const dots = parseAbsolutePath("/work/project/..notes");
    expect(root && inside && isWithin(root, inside)).toBe(true);
    expect(unresolved && formatAbsolutePath(unresolved)).toBe("/work/project/src/../a.txt");
    expect(root && unresolved && isWithin(root, unresolved)).toBe(false);
    expect(root && prefix && isWithin(root, prefix)).toBe(false);
    expect(root && dots && isWithin(root, dots)).toBe(true);
    expect(inside && formatAbsolutePath(inside)).toBe("/work/project/src/a.txt");
    expect(parseAbsolutePath("relative/a.txt")).toBeUndefined();
  });

  it("reads Windows drive paths with either separator", () => {
    const root = parseAbsolutePath("c:\\work\\project");
    const inside = parseAbsolutePath("C:/work/project/a.txt");
    expect(root && inside && isWithin(root, inside)).toBe(true);
    expect(inside && formatAbsolutePath(inside)).toBe("C:\\work\\project\\a.txt");
  });
});

describe("clientPathVerdict", () => {
  const root = parseAbsolutePath("/work/project") as AbsolutePath;
  const target = (path: string) => parseAbsolutePath(path) as AbsolutePath;
  /** The platform's answers for a target inside the tree: the file and every parent prefix resolve to themselves. */
  const insideTree = (file: string) =>
    new Map([file, "/work/project/data", "/work/project", "/work", "/"].map((prefix) => [prefix, prefix] as const));

  it("allows a target the platform resolves inside the session directory", () => {
    expect(
      clientPathVerdict(root, target("/work/project/data/a.txt"), {
        realpaths: insideTree("/work/project/data/a.txt"),
        targetIsSymlink: false
      })
    ).toEqual({ _tag: "resolved", path: "/work/project/data/a.txt" });
    // A link is judged where it points, whatever it is named.
    expect(
      clientPathVerdict(root, target("/work/project/escape.txt"), {
        realpaths: new Map([["/work/project/escape.txt", "/work/secret.txt"]]),
        targetIsSymlink: false
      })
    ).toEqual({ _tag: "refused", reason: "outside-root" });
  });

  it("refuses a link whose target does not exist: where it points cannot be checked", () => {
    expect(
      clientPathVerdict(root, target("/work/project/dangling.txt"), {
        realpaths: insideTree("/work/project/data"),
        targetIsSymlink: true
      })
    ).toEqual({ _tag: "refused", reason: "dangling-link" });
  });

  it("judges a target that does not exist yet by its nearest existing parent", () => {
    expect(
      clientPathVerdict(root, target("/work/project/data/new.txt"), {
        realpaths: insideTree("/work/project/data"),
        targetIsSymlink: false
      })
    ).toEqual({ _tag: "resolved", path: "/work/project/data/new.txt" });
    // A `..` that crosses a directory the platform cannot resolve goes where no check can follow.
    expect(
      clientPathVerdict(root, target("/work/project/data/missing/../../secret.txt"), {
        realpaths: insideTree("/work/project/data"),
        targetIsSymlink: false
      })
    ).toEqual({ _tag: "refused", reason: "unresolved-directory" });
  });

  it("refuses what no existing parent places inside the session directory", () => {
    expect(
      clientPathVerdict(root, target("/work/other/new.txt"), {
        realpaths: new Map(
          ["/work/other/new.txt", "/work/other", "/work", "/"].map((prefix) => [prefix, prefix] as const)
        ),
        targetIsSymlink: false
      })
    ).toEqual({ _tag: "refused", reason: "outside-root" });
  });
});
