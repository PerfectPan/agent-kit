import { describe, expect, it } from "vite-plus/test";

import { isPromptFlags, recordText, userFlags } from "./user-flags.js";
import type { ClaudeCodeContentBlockValue } from "../records/record.js";

const FORK = "<fork-boilerplate>Forked from an earlier session.</fork-boilerplate>\n\nYour directive: fix the tests";
const textBlock = (text: string) => ({ type: "text", text });
const user = (content: string | (ClaudeCodeContentBlockValue | undefined)[], extra: Record<string, unknown> = {}) => ({
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

    expect(userFlags(user([textBlock(FORK)]))).toEqual({});
    expect(recordText(user([textBlock(FORK)]))).toBe(FORK);

    const ideAndImage = [textBlock("<ide_opened_file>/work/app/src/a.ts</ide_opened_file>"), { type: "image" }];
    expect(userFlags(user(ideAndImage))).toEqual({});
    expect(recordText(user(ideAndImage))).toBeUndefined();
    expect(promptOf(user(ideAndImage))).toBeUndefined();
    expect(userFlags(user([{ type: "image" }]))).toEqual({});
    expect(recordText(user([{ type: "image" }]))).toBeUndefined();

    expect(userFlags(user([textBlock("   ")]))).toEqual({});
    expect(recordText(user([textBlock("   ")]))).toBeUndefined();

    expect(recordText(user([textBlock("first part"), textBlock("second part")]))).toBe("first part\n\nsecond part");
    expect(recordText(user([textBlock("hello"), textBlock("<system-reminder>x</system-reminder>")]))).toBe("hello");
  });
});
