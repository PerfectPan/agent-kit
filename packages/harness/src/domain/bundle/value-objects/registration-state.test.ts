import { describe, expect, it } from "vite-plus/test";

import type { CliRegistration } from "./install-adapter.js";
import { ownRecordOf, registrationContent, registrationLinkMismatch } from "./registration-state.js";

const registration = (): CliRegistration => ({
  register: { command: "codex", args: ["plugin", "register", "/u/me/presence"] },
  unregister: { command: "codex", args: ["plugin", "unregister", "presence"] },
  installedCopy: "/u/me/.codex/plugins/presence/hooks.json",
  recorded: {
    entries: [{ kind: "file" as const, path: "/u/me/.codex/config.toml", pointer: "/plugins/presence" }],
    copies: ["/u/me/.codex/plugins/presence"]
  }
});

describe("registrationContent", () => {
  it("reads an enabled registration as its installed copy's text, so an outdated copy is planned again", () => {
    expect(
      registrationContent(true, {
        installedCopy: "/u/me/copy",
        copy: { isFile: true, content: "copy text" }
      })
    ).toBe("copy text");
    expect(
      registrationContent(true, {
        installedCopy: "/u/me/copy",
        copy: { isFile: false, content: null }
      })
    ).toBe(true);
    expect(registrationContent(true, {})).toBe(true);
  });

  it("keeps an explicitly disabled registration as false even with a matching copy", () => {
    expect(
      registrationContent(false, {
        installedCopy: "/u/me/copy",
        copy: { isFile: true, content: "copy" }
      })
    ).toBe(false);
  });

  it("reads as the record itself without an installed copy", () => {
    expect(registrationContent(true, {})).toBe(true);
    expect(registrationContent(undefined, {})).toBeUndefined();
  });
});

describe("ownRecordOf", () => {
  it("finds the command's own entry for a planned pointer and member", () => {
    expect(ownRecordOf(registration(), { pointer: "/plugins/presence" })?.path).toBe("/u/me/.codex/config.toml");
    expect(ownRecordOf(registration(), { pointer: "/plugins/other" })).toBeUndefined();
  });

  it("flags a record path that resolves somewhere other than the planned path", () => {
    expect(registrationLinkMismatch("/u/me/.codex/config.toml", "/data/.codex/config.toml")).toBe(true);
    expect(registrationLinkMismatch("/u/me/.codex/config.toml", "/u/me/.codex/config.toml")).toBe(false);
    expect(registrationLinkMismatch("/u/me/.codex/config.toml", undefined)).toBe(false);
  });
});
