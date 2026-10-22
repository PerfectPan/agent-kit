import { describe, expect, it } from "vite-plus/test";

import type { CliRegistration } from "../spi/install-adapter.js";
import { ownRecordOf, registrationLinkMismatch } from "../services/registration-record.js";
import { RegistrationState } from "./registration-state.js";

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
      RegistrationState.observe(true, {
        installedCopy: "/u/me/copy",
        copy: { isFile: true, content: "copy text" }
      }).content()
    ).toBe("copy text");
    expect(
      RegistrationState.observe(true, { installedCopy: "/u/me/copy", copy: { isFile: false, content: null } }).content()
    ).toBe(true);
    expect(RegistrationState.observe(true, {}).content()).toBe(true);
  });

  it("keeps an explicitly disabled registration as false even with a matching copy", () => {
    expect(
      RegistrationState.observe(false, {
        installedCopy: "/u/me/copy",
        copy: { isFile: true, content: "copy" }
      }).content()
    ).toBe(false);
  });

  it("reads as the record itself without an installed copy", () => {
    expect(RegistrationState.observe(true, {}).content()).toBe(true);
    expect(RegistrationState.observe(undefined, {}).content()).toBeUndefined();
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
