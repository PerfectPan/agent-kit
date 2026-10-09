import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { isUsageSource, listUsageSources, type ListUsageSourcesOptions } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform, type MemoryFile } from "../src/memory-platform.js";
import { readUsageHome } from "./support.js";

const tree = await readUsageHome("/u/me");

async function list(
  files: Record<string, MemoryFile>,
  options: ListUsageSourcesOptions = {},
  env: Record<string, string> = {}
): Promise<{ sources: string[]; failures: string[] }> {
  const platform = createMemoryPlatform({ files, env, home: "/u/me" });
  const sources: string[] = [];
  const failures: string[] = [];
  for await (const item of listUsageSources(platform, options)) {
    if (isUsageSource(item)) {
      sources.push(`${item.agent} ${item.path}`);
    } else {
      failures.push(`${item.agent} ${item.error._tag} ${item.path}`);
    }
  }
  return { sources: sources.toSorted(), failures };
}

/** The fixture tree with each `/u/me/<from>` moved to `<to>`. */
function moved(...moves: readonly (readonly [from: string, to: string])[]): Record<string, MemoryFile> {
  return Object.fromEntries(
    Object.entries(tree).map(([path, content]) => {
      const move = moves.find(([from]) => path.startsWith(`/u/me/${from}/`));
      return [move ? `${move[1]}/${path.slice(`/u/me/${move[0]}/`.length)}` : path, content];
    })
  );
}

const ALL = [
  "claude-code /u/me/.claude/projects/-u-me-work/s-usage.jsonl",
  "claude-code /u/me/.claude/projects/-u-me-work/s-usage/subagents/agent-helper.jsonl",
  "codex /u/me/.codex/archived_sessions/rollout-2025-12-31T00-00-00-cx-archived.jsonl",
  "codex /u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-totals.jsonl",
  "codex /u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-10-00-cx-fork.jsonl",
  "codex /u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-20-00-cx-edge.jsonl",
  "gemini-cli /u/me/.gemini/tmp/projhash/chats/gm-1/sub-1.jsonl",
  "gemini-cli /u/me/.gemini/tmp/projhash/chats/session-2026-01-01T00-00-gm1.jsonl",
  "gemini-cli /u/me/.gemini/tmp/projhash/chats/session-legacy.json",
  "gemini-cli /u/me/.gemini/tmp/projhash/chats/session-migrated.jsonl",
  "grok /u/me/.grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl",
  "opencode /u/me/.local/share/opencode/storage/message/ses_legacy",
  "pi /u/me/.pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl",
  "pi /u/me/.pi/agent/sessions/--u-me-work--/2026-01-02T00-00-00-000Z_pi-fork.jsonl"
];

describe("listUsageSources", () => {
  it("lists every agent's sources: subagent files, archived rollouts, chats and the older opencode layout", async () => {
    // Not listed: a workflow journal, Gemini's logs and a `.json` chat that its `.jsonl` sibling replaced.
    expect(await list(tree)).toEqual({ sources: ALL, failures: [] });
  });

  it("follows each agent's home variable", async () => {
    const files = moved(
      [".claude", "/alt/claude"],
      [".codex", "/alt/codex"],
      [".gemini", "/alt/gemini-home/.gemini"],
      [".grok", "/alt/grok"],
      [".local/share/opencode", "/alt/data/opencode"],
      [".pi/agent", "/alt/pi"]
    );
    const { sources, failures } = await list(
      files,
      {},
      {
        CLAUDE_CONFIG_DIR: "/alt/claude",
        CODEX_HOME: "/alt/codex",
        GEMINI_CLI_HOME: "/alt/gemini-home",
        GROK_HOME: "/alt/grok",
        XDG_DATA_HOME: "/alt/data",
        PI_CODING_AGENT_DIR: "/alt/pi"
      }
    );
    expect(failures).toEqual([]);
    expect(sources).toHaveLength(ALL.length);
    expect(sources.every((source) => source.includes(" /alt/"))).toBe(true);
  });

  it("leaves out files last modified before `since`", async () => {
    const old = "/u/me/.codex/archived_sessions/rollout-2025-12-31T00-00-00-cx-archived.jsonl";
    const files = { ...tree, [old]: { content: tree[old]!, mtimeMs: Date.parse("2025-12-31T00:00:00.000Z") } };
    const { sources } = await list(files, { agents: ["codex"], since: Date.parse("2026-01-01T00:00:00.000Z") });
    expect(sources).toHaveLength(3);
    expect(sources.some((source) => source.includes("archived"))).toBe(false);
  });

  it("keeps the decoder table out of the public surface", async () => {
    const names = Object.keys(await import("@rivus/agent-kit-sessions/public"));
    expect(names).toContain("scanUsage");
    expect(names).not.toContain("builtinUsageDecoders");
  });

  it("reports a missing root as a failure item and throws for an agent without a decoder", async () => {
    expect(await list(moved([".pi/agent", "/elsewhere"]), { agents: ["pi"] })).toEqual({
      sources: [],
      failures: ["pi RootMissing /u/me/.pi/agent/sessions"]
    });
    const error = await list(tree, { agents: ["my-agent"] }).catch((caught: unknown) => caught);
    expect(isAgentKitError(error) && error.code).toBe("capability-unsupported");
  });
});
