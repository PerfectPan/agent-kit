import { claudeCodeSessionAdapter } from "../src/sessions.js";
import { claudeCode } from "../src/identity.js";
import { fileURLToPath } from "node:url";

import type { Result } from "@rivus/agent-kit-catalog/public";
import {
  foldTranscript,
  loadTranscript,
  sessionPrompts,
  summarizeSession,
  type SessionPromptsOptions,
  type Transcript
} from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { readTree } from "../../../testing/test/support.js";
import { previewClaudeCodeRecords } from "../src/sessions/preview.js";
import { isPromptFlags, recordText, userFlags } from "../src/sessions/user-flags.js";

const textBlock = (text: string) => ({ type: "text", text });
const user = (content: string | ReturnType<typeof textBlock>[], extra: Record<string, unknown> = {}) => ({
  type: "user",
  uuid: "u",
  timestamp: "2026-01-01T00:00:00.000Z",
  sessionId: "s",
  version: "2.0.0",
  message: { role: "user", content },
  ...extra
});

/** The prompt text and title a record collects: its prompt text only when its flags leave it a real prompt. */
const promptOf = (record: Parameters<typeof userFlags>[0]): string | undefined =>
  isPromptFlags(userFlags(record)) ? recordText(record) : undefined;

describe("the Claude Code prompt rule", () => {
  it("reads a whitespace-free single block or string content like the record rule it came from", () => {
    expect(userFlags(user("Run the tests"))).toEqual({});
    expect(userFlags(user([textBlock("Run the tests")]))).toEqual({});
    expect(promptOf(user("Run the tests"))).toBe("Run the tests");
    expect(promptOf(user([textBlock("Run the tests")]))).toBe("Run the tests");

    const wrapper = "<command-name>/clear</command-name>\n<command-message>clear</command-message>";
    expect(userFlags(user(wrapper))).toEqual({ command: true });
    expect(userFlags(user([textBlock(wrapper)]))).toEqual({ command: true });
    expect(promptOf(user([textBlock(wrapper)]))).toBeUndefined();

    expect(userFlags(user([textBlock("[Request interrupted by user]")]))).toEqual({ injected: true });
    expect(userFlags(user("<system-reminder>Files changed.</system-reminder>"))).toEqual({ injected: true });
    expect(promptOf(user([textBlock("[Request interrupted by user]")]))).toBeUndefined();
  });

  it("judges each text block, so host context first neither hides nor replaces the user's text", () => {
    const ide = [
      textBlock("<ide_opened_file>/work/app/src/a.ts</ide_opened_file>"),
      textBlock("<ide_selection>const a = 1;</ide_selection>"),
      textBlock("fix the bug")
    ];
    expect(userFlags(user(ide))).toEqual({});
    expect(recordText(user(ide))).toBe("fix the bug");

    const reminder = [
      textBlock("<system-reminder>Files changed on disk.</system-reminder>"),
      textBlock("continue with the tests")
    ];
    expect(userFlags(user(reminder))).toEqual({});
    expect(recordText(user(reminder))).toBe("continue with the tests");

    const allInjected = [
      textBlock("<task-notification>Background task finished.</task-notification>"),
      textBlock("<system-reminder>Exit code 0.</system-reminder>")
    ];
    expect(userFlags(user(allInjected))).toEqual({ injected: true });
    expect(recordText(user(allInjected))).toBeUndefined();

    expect(
      userFlags(user([textBlock("<fork-boilerplate>Forked from an earlier session.</fork-boilerplate>")]))
    ).toEqual({ injected: true });

    expect(userFlags(user([textBlock("   ")]))).toEqual({});
    expect(recordText(user([textBlock("   ")]))).toBeUndefined();

    expect(recordText(user([textBlock("first part"), textBlock("second part")]))).toBe("first part\n\nsecond part");
    expect(recordText(user([textBlock("hello"), textBlock("<system-reminder>x</system-reminder>")]))).toBe("hello");
  });
});

const tree = await readTree(fileURLToPath(new URL("fixtures/sessions", import.meta.url)), "/u/me/.claude/fx");
const fixtureFiles = Object.fromEntries(
  Object.entries(tree).map(([path, bytes]) => [path.replace("/.claude/fx/conformance/", "/.claude/projects/"), bytes])
);
const platform = createMemoryPlatform({ files: fixtureFiles, home: "/u/me" });
const providers = { sessions: { "claude-code": claudeCodeSessionAdapter }, identity: { "claude-code": claudeCode } };
const path = "/u/me/.claude/projects/prompt-blocks/session.jsonl";

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};
const load = async (): Promise<Transcript> =>
  value(await loadTranscript(platform, { agent: "claude-code", path }, { providers }));

describe("the prompt rule over the prompt-blocks fixture", () => {
  it("marks the host-added blocks and keeps the user's blocks as the prompts", async () => {
    const transcript = await load();
    const payload = (id: string) => transcript.events.find((event) => event.id === id)?.payload;
    expect(payload("b-u2")).toEqual({ injected: true, text: "<ide_opened_file>/work/app/src/a.ts</ide_opened_file>" });
    expect(payload("b-u2:1")).toEqual({ injected: true, text: "<ide_selection>const a = 1;</ide_selection>" });
    expect(payload("b-u2:2")).toEqual({ text: "fix the bug" });
    expect(payload("b-u3")).toEqual({
      injected: true,
      text: "<system-reminder>Files changed on disk.</system-reminder>"
    });
    expect(payload("b-u3:1")).toEqual({ text: "continue with the tests" });
    expect(payload("b-u4")).toEqual({
      injected: true,
      text: "<task-notification>Background task finished.</task-notification>"
    });
    expect(payload("b-u4:1")).toEqual({ injected: true, text: "<system-reminder>Exit code 0.</system-reminder>" });
    expect(payload("b-u5")).toEqual({
      injected: true,
      text: "<fork-boilerplate>Forked from an earlier session.</fork-boilerplate>"
    });
  });

  it("titles the session and previews the first prompt from the user's own text", async () => {
    const transcript = await load();
    expect(transcript.session.title).toBe("Start the fix");
    const records = new TextDecoder()
      .decode(fixtureFiles["/u/me/.claude/projects/prompt-blocks/session.jsonl"]!)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(previewClaudeCodeRecords(records).firstPrompt).toBe("Start the fix");
  });

  it("collects the same turns and prompts from the fold and the fast pass, trimmed and capped", async () => {
    const transcript = await load();
    const folded = foldTranscript(transcript);
    expect(folded.turns).toBe(6);
    const options: SessionPromptsOptions = { limit: 10, maxChars: 8 };
    const fast = value(
      await summarizeSession(platform, { agent: "claude-code", path }, { providers, prompts: options })
    );
    expect(fast.turns).toBe(6);
    expect(fast).toEqual({ ...folded, prompts: sessionPrompts(transcript, options) });
    // Leading whitespace stays out of the cap, and the whitespace-only record collects no prompt.
    expect(sessionPrompts(transcript, options)).toEqual([
      { text: "Start th" },
      { text: "fix the " },
      { text: "continue" },
      { text: "capsize1" },
      { text: "first pa" }
    ]);
    expect(sessionPrompts(transcript, { limit: 10, maxChars: 200 })).toEqual([
      { text: "Start the fix" },
      { text: "fix the bug" },
      { text: "continue with the tests" },
      { text: "capsize12" },
      { text: "first part\n\nsecond part" }
    ]);
  });
});
