import { describe, expect, it } from "vitest";

import type { ArtifactLocator } from "../../domain/install-plan/index.js";
import type { JsonValue } from "../../domain/ledger/index.js";
import { entryEdits, entryValue, listEntries } from "../services/config-entries.js";
import { editJsonc, parseJsonc } from "./jsonc-editor.js";
import { editToml, parseToml } from "./toml-editor.js";

const hook = (event: string, command: string): ArtifactLocator => ({
  kind: "json-entry",
  path: "/u/me/.claude/settings.json",
  pointer: `/hooks/${event}`,
  member: command,
  memberIn: "hook-group"
});

function jsonc(text: string | undefined, locator: ArtifactLocator, value: JsonValue | undefined): string {
  const data = text === undefined ? undefined : parseJsonc(text);
  const edits = entryEdits(data?.ok === true ? data.value : undefined, locator, value);
  if (!edits.ok) {
    throw new Error(edits.error.detail);
  }
  return editJsonc(text, edits.value);
}

function toml(text: string, locator: ArtifactLocator, value: JsonValue | undefined): string {
  const data = parseToml(text);
  const edits = entryEdits(data.ok ? data.value : undefined, locator, value);
  if (!edits.ok || !data.ok) {
    throw new Error("edit failed");
  }
  const edited = editToml(text, data.value, edits.value);
  if (!edited.ok) {
    throw new Error(edited.error.detail);
  }
  return edited.value;
}

const SETTINGS = `{
  // comment kept
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "~/bin/notify.sh" }
        ]
      }
    ]
  }
}
`;

describe("document values", () => {
  it("reads every number TOML holds: infinities, NaN and big integers", () => {
    const parsed = parseToml("limit = inf\nv = nan\nbig = 9223372036854775807\n");
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) {
      throw new Error(parsed.error.detail);
    }
    expect(parsed.value).toEqual({ limit: Infinity, v: NaN, big: 9223372036854775807n });
  });

  it("reads a JSON number too large for double precision as infinity", () => {
    const parsed = parseJsonc('{"wide": 1e400}');
    expect(parsed).toMatchObject({ ok: true, value: { wide: Infinity } });
  });

  it("keeps an own __proto__ key of a TOML document through an edit", () => {
    const text = 'model = "gpt"\n"__proto__" = "x"\n';
    const parsed = parseToml(text);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) {
      throw new Error(parsed.error.detail);
    }
    if (typeof parsed.value !== "object" || parsed.value === null) {
      throw new Error("no document");
    }
    expect(Object.hasOwn(parsed.value, "__proto__")).toBe(true);
    const locator: ArtifactLocator = { kind: "toml-entry", path: "/codex/config.toml", pointer: "/model" };
    expect(toml(text, locator, "o4")).toContain('"__proto__" = "x"');
  });
});

describe("JSONC entries", () => {
  it("S93: adds a hook as a group of its own next to the user's, and removing it restores the text", () => {
    const ours = { type: "command", command: "/opt/x hook", timeout: 5 };
    const added = jsonc(SETTINGS, hook("Stop", "/opt/x hook"), ours);
    expect(added).toContain("// comment kept");
    const data = parseJsonc(added);
    expect(data.ok && entryValue(data.value, hook("Stop", "/opt/x hook"))).toEqual({ ok: true, value: ours });
    expect(data.ok && entryValue(data.value, hook("Stop", "~/bin/notify.sh"))).toMatchObject({ ok: true });
    expect(jsonc(added, hook("Stop", "/opt/x hook"), undefined)).toBe(SETTINGS);
  });

  it("creates the event list and the hooks object, and removes them again when they hold nothing else", () => {
    const text = '{\n  "model": "opus"\n}\n';
    const added = jsonc(text, hook("SessionStart", "/opt/x"), { type: "command", command: "/opt/x" });
    expect(JSON.parse(added)).toEqual({
      model: "opus",
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "/opt/x" }] }] }
    });
    expect(jsonc(added, hook("SessionStart", "/opt/x"), undefined)).toBe(text);
  });

  it("starts a missing file as an object and edits list elements by identity", () => {
    const plugins: ArtifactLocator = {
      kind: "json-entry",
      path: "/p/opencode.json",
      pointer: "/plugin",
      member: "./a.js"
    };
    const created = jsonc(undefined, plugins, "./a.js");
    expect(JSON.parse(created)).toEqual({ plugin: ["./a.js"] });
    const inline = '{ "plugin": ["other", "./a.js", "last"] }\n';
    expect(jsonc(inline, plugins, undefined)).toBe('{ "plugin": ["other", "last"] }\n');
    expect(listEntries(JSON.parse(inline), "/plugin", "element").map((entry) => entry.locator.member)).toEqual([
      "other",
      "./a.js",
      "last"
    ]);
  });

  it("refuses a document with a syntax error and an entry where a list belongs to something else", () => {
    expect(parseJsonc("{ broken")).toMatchObject({ ok: false, error: { _tag: "DocumentInvalid", format: "json" } });
    expect(entryEdits({ hooks: { Stop: "x" } }, hook("Stop", "/opt/x"), {})).toMatchObject({
      ok: false,
      error: { _tag: "UnexpectedShape" }
    });
  });

  it("lists every hook under an event object, with the event as the pointer", () => {
    const data = parseJsonc(SETTINGS);
    expect(data.ok && listEntries(data.value, "/hooks", "hook-group").map((entry) => entry.locator)).toEqual([
      { pointer: "/hooks/Stop", member: "~/bin/notify.sh", memberIn: "hook-group" }
    ]);
  });
});

const CODEX = `# Codex configuration
model = "gpt-5.5" # the default model

[features]
# kept
hooks = true

[mcp_servers.docs]
command = "docs-mcp" # keep me
`;

describe("TOML entries", () => {
  const stop: ArtifactLocator = {
    kind: "toml-entry",
    path: "/u/me/.codex/config.toml",
    pointer: "/hooks/Stop",
    member: "/opt/x codex",
    memberIn: "hook-group"
  };

  it("S93: keeps every comment of a Codex config.toml while it adds and removes hook groups", () => {
    const added = toml(CODEX, stop, { type: "command", command: "/opt/x codex", timeout: 5 });
    for (const line of CODEX.split("\n")) {
      expect(added).toContain(line);
    }
    const data = parseToml(added);
    expect(data.ok && data.value).toMatchObject({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "/opt/x codex", timeout: 5 }] }] }
    });
    const second = toml(added, { ...stop, member: "/opt/y" }, { type: "command", command: "/opt/y" });
    expect(toml(second, { ...stop, member: "/opt/y" }, undefined)).toBe(added);
    expect(toml(added, stop, undefined).trim()).toBe(CODEX.trim());
  });

  it("refuses a document that does not parse", () => {
    expect(parseToml("[broken")).toMatchObject({ ok: false, error: { _tag: "DocumentInvalid", format: "toml" } });
  });

  /** One hook group in Codex's documented layout: an array table and its handlers as array tables. */
  const group = (command: string, matcher?: string) =>
    `[[hooks.Stop]]\n${matcher === undefined ? "" : `matcher = ${JSON.stringify(matcher)}\n`}\n` +
    `[[hooks.Stop.hooks]]\ntype = "command"\ncommand = ${JSON.stringify(command)} # the user's\n`;
  const ours = { type: "command", command: "/opt/x codex", timeout: 5 };

  it("S93: adds a group next to the user's array-table groups and removes it again byte for byte", () => {
    const text = `model = "gpt-5.5"\n\n${group("/usr/local/bin/notify", "")}`;
    const added = toml(text, stop, ours);
    const data = parseToml(added);
    expect(data.ok && data.value).toEqual({
      model: "gpt-5.5",
      hooks: {
        Stop: [{ matcher: "", hooks: [{ type: "command", command: "/usr/local/bin/notify" }] }, { hooks: [ours] }]
      }
    });
    expect(toml(added, stop, undefined)).toBe(text);
  });

  it.each([0, 1, 2])(
    "S93: removes the owner's group at position %i of three and keeps the user's byte for byte",
    (at) => {
      const groups = [group("/usr/local/bin/a"), group("/usr/local/bin/b", "Bash")];
      const withOurs = [...groups];
      withOurs.splice(at, 0, group("/opt/old legacy-demo hook"));
      const text = `# config\nmodel = "gpt-5.5"\n\n${withOurs.join("\n")}\n[mcp_servers.docs]\ncommand = "docs-mcp"\n`;
      const removed = toml(text, { ...stop, member: "/opt/old legacy-demo hook" }, undefined);
      expect(removed).toBe(
        `# config\nmodel = "gpt-5.5"\n\n${groups.join("\n")}\n[mcp_servers.docs]\ncommand = "docs-mcp"\n`
      );
    }
  );

  it("S93: removes one handler of a group with two and the event when its last group goes", () => {
    const text =
      `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/usr/local/bin/notify"\n\n` +
      `[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/opt/x codex"\ntimeout = 5\n`;
    const removed = toml(text, stop, undefined);
    expect(removed).toBe(
      `[[hooks.Stop]]\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "/usr/local/bin/notify"\n`
    );
    expect(toml(removed, { ...stop, member: "/usr/local/bin/notify" }, undefined)).toBe("");
  });

  it("S93: removes an element of an inline group list and keeps the others", () => {
    const text =
      `[hooks]\nStop = [ { hooks = [ { type = "command", command = "/usr/local/bin/notify" } ] }, ` +
      `{ hooks = [ { type = "command", command = "/opt/x codex", timeout = 5 } ] } ]\n`;
    expect(toml(text, stop, undefined)).toBe(
      `[hooks]\nStop = [ { hooks = [ { type = "command", command = "/usr/local/bin/notify" } ] } ]\n`
    );
  });
});
