import { describe, expect, it } from "vitest";

import { builtinProbeRecipes } from "../../domain/adapters/index.js";
import type { ProbeRecipe } from "../../domain/installation/index.js";
import { expandProbePath, findCommand, type PathCheck } from "./host-paths.js";

const files = (...paths: string[]) => {
  const checked: string[] = [];
  const check = async (path: string): Promise<PathCheck> => {
    checked.push(path);
    return paths.includes(path) ? { kind: "file", size: 0, mtimeMs: 0 } : undefined;
  };
  return { check, checked };
};

describe("expandProbePath", () => {
  const recipe: ProbeRecipe = { ...builtinProbeRecipes.codex, agent: "my-agent", home: { defaultPath: [".mine"] } };

  it("expands ~ against the home directory and keeps absolute paths", () => {
    const platform = { env: {}, home: "/u/me/" };
    expect(expandProbePath("~", platform, recipe)).toBe("/u/me/");
    expect(expandProbePath("~/.x/y", platform, recipe)).toBe("/u/me/.x/y");
    expect(expandProbePath("/Applications/X.app", platform, recipe)).toBe("/Applications/X.app");
    expect(expandProbePath("~other/x", platform, recipe)).toBe("~other/x");
  });

  it("follows the agent's home rule, including its override variable, or the recipe's own rule", () => {
    const platform = { env: { GEMINI_CLI_HOME: "/alt" }, home: "/u/me" };
    expect(expandProbePath({ agentHome: "gemini-cli", path: "settings.json" }, platform, recipe)).toBe(
      "/alt/.gemini/settings.json"
    );
    expect(expandProbePath({ agentHome: "my-agent", path: "a/b" }, platform, recipe)).toBe("/u/me/.mine/a/b");
    expect(() => expandProbePath({ agentHome: "other-agent" }, platform, recipe)).toThrow(/other-agent/);
  });
});

describe("findCommand", () => {
  it("returns the first file named like the command in PATH order", async () => {
    const { check, checked } = files("/b/tool", "/c/tool");
    const platform = { os: "linux", env: { PATH: "/a:/b/:/c" } } as const;
    expect((await findCommand(platform, check, "tool")).path).toBe("/b/tool");
    expect(checked).toEqual(["/a/tool", "/b/tool"]);
  });

  it("tries each PATHEXT extension on Windows, unless the command has one", async () => {
    const platform = { os: "win32", env: { path: "C:\\bin;D:/tools", PathExt: ".EXE;.CMD" } } as const;
    const { check, checked } = files("D:/tools/tool.CMD");
    expect((await findCommand(platform, check, "tool")).path).toBe("D:/tools/tool.CMD");
    expect(checked).toEqual(["C:\\bin\\tool.EXE", "C:\\bin\\tool.CMD", "D:/tools/tool.EXE", "D:/tools/tool.CMD"]);
    expect((await findCommand(platform, files("C:\\bin\\tool.cmd").check, "tool.cmd")).path).toBe("C:\\bin\\tool.cmd");
  });

  it("skips relative and empty entries, which would resolve against the working directory", async () => {
    const { check, checked } = files();
    expect(await findCommand({ os: "darwin", env: { PATH: ":.:bin:/ok" } }, check, "tool")).toEqual({ problems: [] });
    expect(checked).toEqual(["/ok/tool"]);
  });
});
