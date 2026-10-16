import { describe, expect, it } from "vite-plus/test";

import { hookProgram } from "./hook-program.js";

describe("hookProgram", () => {
  it.each([
    ["'/a b/hook' --x", "/a b/hook"],
    ['"/a b/hook"', "/a b/hook"],
    [" \t '/a b/hook' --x", "/a b/hook"],
    [String.raw`/a\ b/hook --x`, "/a b/hook"],
    ["'/a b'/hook", "/a b/hook"],
    [String.raw`"/a \"b\"/hook"`, '/a "b"/hook'],
    [String.raw`'/tmp/it'\''s/hook'`, "/tmp/it's/hook"],
    ["/hook>/dev/null", "/hook"],
    ["/hook&&/bin/true", "/hook"],
    ["/hook | /bin/cat", "/hook"],
    [String.raw`/a\;b/hook`, "/a;b/hook"],
    ["'/a;b/hook'", "/a;b/hook"],
    ["/opt/hook --user $USER", "/opt/hook"],
    ["'/opt/$USER/hook'", "/opt/$USER/hook"],
    [String.raw`'/a\ b/hook'`, String.raw`/a\ b/hook`],
    [String.raw`"/a\q\ b/hook"`, String.raw`/a\q\ b/hook`],
    ["/hook$", "/hook$"],
    ["/gone/bin/old-hook", "/gone/bin/old-hook"],
    ["/hook # comment", "/hook"]
  ])("%s → %s", (command, program) => {
    expect(hookProgram(command)).toBe(program);
  });

  it.each([
    ["/opt/$USER/hook", "a $VAR expansion"],
    ["/opt/${USER}/hook", "a ${VAR} expansion"],
    ['"/opt/$USER/hook"', "a double-quoted parameter"],
    ["/opt/hook*", "a glob"],
    ["/opt/hook?", "a single-character glob"],
    ["/a$VAR/*/hook --x", "a parameter inside a glob"],
    ["/a/$(echo b)/hook", "a command substitution"],
    ["/opt/hook$(echo)", "a command substitution at the end of the word"],
    ["/a/`echo b`/hook", "a backquoted part"],
    ["/opt/`whoami`/hook", "a backquoted part with no space"],
    ['"/a\\\\b/\\$VAR/\\`hook\\`"', "a quoted literal backtick"],
    ["npx demo-hook --event Stop", "a relative command"],
    ["~/bin/hook", "a tilde, which is not expanded"],
    ["", "an empty command"],
    [" \t\n", "only whitespace"],
    ["'' --x", "an empty word"],
    ["# /opt/hook", "a comment"],
    ["${}", "an empty substitution, which shell-quote rejects"],
    ["${", "an unfinished substitution, which shell-quote rejects"]
  ])("%s is not checked: %s", (command) => {
    expect(hookProgram(command)).toBeUndefined();
  });

  it("an unterminated quote is dropped and the space splits the word, so the program is the text before the space", () => {
    expect(hookProgram("'/a b/hook")).toBe("/a");
    expect(hookProgram('"/a b/hook')).toBe("/a");
  });

  it("an escaped newline splits the word, so the program is the text before the break", () => {
    expect(hookProgram("/a\\\nb/hook --x")).toBe("/a");
  });

  it("a leading escaped newline is an empty first word, so the path after it is not checked", () => {
    expect(hookProgram("\\\n \t /hook")).toBeUndefined();
  });

  it("an escaped newline inside double quotes stays in the word", () => {
    expect(hookProgram('"/a\\\nb/hook"')).toBe("/a\\\nb/hook");
  });
});
