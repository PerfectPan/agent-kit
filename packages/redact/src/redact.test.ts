import { describe, expect, it } from "vite-plus/test";

import { redact, redactText } from "./redact.js";

const home = "/u/me";
const text = (value: string, at = home) => redactText(value, { home: at });

// Secret-shaped samples are assembled at run time, so the repository's own secret scan does not flag this file.
const fake = (prefix: string, length = 24) => `${prefix}${"Ab1".repeat(length).slice(0, length)}`;

describe("redactText", () => {
  it("S60: replaces the home directory unless the next character continues the segment", () => {
    expect(text(`I am in ${home}.`)).toBe("I am in ~.");
    expect(text(`PATH=${home}:/usr/bin`)).toBe("PATH=~:/usr/bin");
    expect(text(`(${home})`)).toBe("(~)");
    expect(text(`${home}/proj/a.ts`)).toBe("~/proj/a.ts");
    expect(text(`${home}x ${home}.bak ${home}-old ${home}é`)).toBe(`${home}x ${home}.bak ${home}-old ${home}é`);
    expect(text(`${home.toUpperCase()}/x`)).toBe("~/x");
    expect(text("/u/meeting and /var/u/me2")).toBe("/u/meeting and /var/u/me2");
  });

  it("S60: replaces the home directory after any character, without its leading slash, and JSON-escaped", () => {
    expect(text(`diff --git a${home}/x b${home}/x`)).toBe("diff --git a~/x b~/x");
    expect(text(`cd u/me/x`)).toBe("cd ~/x");
    expect(text("menu/me/x")).toBe("menu/me/x");
    expect(text(String.raw`{"cwd":"\/u\/me\/x"}`)).toBe(String.raw`{"cwd":"~\/x"}`);
  });

  it("S60: replaces file URLs, including a percent-encoded home", () => {
    expect(text(`file://${home}/x`)).toBe("file://~/x");
    expect(text("file:///u/john%20doe/x", "/u/john doe")).toBe("file://~/x");
    expect(text("open /u/john doe/x", "/u/john doe")).toBe("open ~/x");
  });

  it("S60: replaces the Claude Code slug and the percent-encoded folder names of any home", () => {
    expect(text("proj -u-me-code file")).toBe("proj ~-code file");
    expect(text("dir %2Fu%2Fme%2Fsessions")).toBe("dir ~%2Fsessions");
    expect(text("dir %2fu%2fme%2fsessions")).toBe("dir ~%2fsessions");
    expect(text("x -u-john-doe-proj/a.jsonl", "/u/john.doe")).toBe("x ~-proj/a.jsonl");
    expect(text("x %2Fu%2Fzo%C3%AB%2Fproj", "/u/zoë")).toBe("x ~%2Fproj");
  });

  it("S60: hides a multi-segment home's slug after any character that is not a letter, digit, `_` or `%`", () => {
    const slug = "-Users-alice-proj";
    const nameChar = /[A-Za-z0-9_%]/;
    for (let code = 0x20; code <= 0x7e; code++) {
      const before = String.fromCharCode(code);
      expect(text(`${before}${slug}`, "/Users/alice")).toBe(
        nameChar.test(before) ? `${before}${slug}` : `${before}~-proj`
      );
    }
    expect(text(slug, "/Users/alice")).toBe("~-proj");
    const leak = (value: string) => text(value, "/Users/alice");
    expect(leak(`find ~/.claude/projects -name "*${slug}*"`)).toBe(`find ~/.claude/projects -name "*~-proj*"`);
    expect(leak(`**${slug}**`)).toBe("**~-proj**");
    expect(leak(`[${slug}](x)`)).toBe("[~-proj](x)");
  });

  it("S60: replaces Windows spellings: either separator, JSON-escaped, file URLs and MSYS paths", () => {
    const windows = String.raw`C:\Profiles\me`;
    const at = (value: string) => text(value, windows);
    expect(at(String.raw`C:\Profiles\me\proj`)).toBe(String.raw`~\proj`);
    expect(at(String.raw`c:\profiles\ME\proj`)).toBe(String.raw`~\proj`);
    expect(at("C:/Profiles/me/proj")).toBe("~/proj");
    expect(at(String.raw`{"cwd":"C:\\Profiles\\me\\proj"}`)).toBe(String.raw`{"cwd":"~\\proj"}`);
    expect(at("file:///C:/Profiles/me/proj")).toBe("file:///~/proj");
    expect(at("/c/Profiles/me/proj")).toBe("~/proj");
    expect(at(String.raw`C:\Profiles\meg\x`)).toBe(String.raw`C:\Profiles\meg\x`);
    expect(at("C--Profiles-me-proj")).toBe("~-proj");
    expect(at("*C--Profiles-me-proj")).toBe("*~-proj");
  });

  it("S60: replaces ~user, the shell's name for the home directory, also after a JSON escape", () => {
    expect(text("ls ~me/x and ~me")).toBe("ls ~/x and ~");
    expect(text("~meg/x")).toBe("~meg/x");
    expect(text(String.raw`"cd\n~me/x"`)).toBe(String.raw`"cd\n~/x"`);
  });

  it("does not hide the word of a one-segment home, and needs a segment start for the slug", () => {
    const root = "/root";
    expect(text("running as root, see /root/x and -root-proj", root)).toBe("running as root, see ~/x and ~-proj");
    expect(text("pre-root and %2Froot%2Fx", root)).toBe("pre-root and ~%2Fx");
    expect(text("npm --root-dir x *-root-p x.-root a--root", root)).toBe("npm --root-dir x *-root-p x.-root a--root");
    expect(text("*C--me-p", String.raw`C:\me`)).toBe("*C--me-p");
    expect(text("*C---me-p", "C:\\\\me")).toBe("*C---me-p");
    expect(text("x.--root", "//root")).toBe("x.--root");
    expect(text("cd u/me/x")).toBe("cd ~/x");
  });

  it("hides no path for an empty home or a file system root", () => {
    for (const root of ["", "/", "C:\\", "C:/"]) {
      expect(text("/u/me/x C:/x", root)).toBe("/u/me/x C:/x");
    }
    expect(text(`${home}/x`, `${home}/`)).toBe("~/x");
  });

  it.each([
    ["sk-", 24],
    ["sk-ant-api03-", 24],
    ["AKIA", 16],
    ["ghp_", 36],
    ["gho_", 36],
    ["github_pat_", 40],
    ["xoxb-", 30],
    ["npm_", 36]
  ])("S60: replaces a secret with the published prefix %s", (prefix, length) => {
    expect(text(`key=${fake(prefix, length)} rest`)).toBe("key=[redacted] rest");
  });

  it("S60: replaces a secret right after a JSON escape or URL encoding", () => {
    const secret = fake("sk-ant-api03-");
    expect(text(String.raw`{"text":"line\n${secret}"}`)).toBe(String.raw`{"text":"line\n[redacted]"}`);
    expect(text(String.raw`{"text":"\u0022${secret}"}`)).toBe(String.raw`{"text":"\u0022[redacted]"}`);
    expect(text(`?key%3D${secret}&x=1`)).toBe("?key%3D[redacted]&x=1");
    expect(text(`%22${fake("ghp_", 36)}%22`)).toBe("%22[redacted]%22");
  });

  it("S60: replaces a PEM private key block, and one cut off before its END line up to the end of its base64", () => {
    const begin = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
    const end = ["-----END", "PRIVATE", "KEY-----"].join(" ");
    expect(text(`a ${begin}\nMIIabc\n${end} b`)).toBe("a [redacted] b");
    expect(text(`a ${begin}\nMIIabc+/=\nQUJD`)).toBe("a [redacted]");
    expect(text(String.raw`{"key":"${begin}\nMIIabc\nQUJD","next":1}`)).toBe(String.raw`{"key":"[redacted]","next":1}`);
  });

  it("keeps words that only contain a prefix, and short values", () => {
    expect(text("task-abcdefgh1234 risk-assessment sk-short")).toBe("task-abcdefgh1234 risk-assessment sk-short");
  });
});

describe("redact", () => {
  it("S60: copies a JSON value, redacting strings and object keys, without mutating it", () => {
    const secret = fake("sk-");
    const input = {
      cwd: `${home}/proj`,
      events: [{ text: `token ${secret} in ${home}/notes`, count: 2, ok: true, none: null }],
      [`${home}/proj/a.ts`]: 1,
      "-u-me-proj": "x"
    };
    const output = redact(input, { home });
    expect(output).toEqual({
      cwd: "~/proj",
      events: [{ text: "token [redacted] in ~/notes", count: 2, ok: true, none: null }],
      "~/proj/a.ts": 1,
      "~-proj": "x"
    });
    expect(input.cwd).toBe(`${home}/proj`);
    expect(JSON.stringify(output)).not.toContain("me/");
  });

  it("returns objects that are not plain data unchanged", () => {
    const date = new Date(0);
    const map = new Map([["k", `${home}/x`]]);
    const output = redact({ date, map }, { home });
    expect(output.date).toBe(date);
    expect(output.map).toBe(map);
  });
});
