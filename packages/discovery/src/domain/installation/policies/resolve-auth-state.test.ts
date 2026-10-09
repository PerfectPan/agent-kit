import { describe, expect, it } from "vite-plus/test";

import type { DetectionStatus } from "../value-objects/detection-status.js";
import type { AuthObservation } from "../value-objects/auth-state.js";
import { envReading, probesAuth, resolveAuthState } from "./resolve-auth-state.js";

const command = (loggedIn: boolean, method?: string): AuthObservation => ({
  source: { kind: "command", command: "/bin/x", args: ["status"] },
  reading: method === undefined ? { loggedIn } : { loggedIn, method }
});
const file: AuthObservation = {
  source: { kind: "credential-file", path: "/u/me/.x/auth" },
  reading: { loggedIn: true }
};
const variable: AuthObservation = {
  source: { kind: "env", variable: "X_KEY" },
  reading: { loggedIn: true }
};

describe("resolveAuthState", () => {
  it("lets the status command decide, even against stored credentials", () => {
    expect(resolveAuthState([file, command(false)])).toEqual({
      status: "logged-out",
      source: command(false).source
    });
    expect(resolveAuthState([variable, command(true, "api-key")])).toEqual({
      status: "logged-in",
      method: "api-key",
      source: command(true).source
    });
  });

  it("counts stored credentials as logged in, in observation order", () => {
    expect(resolveAuthState([variable, file])).toEqual({
      status: "logged-in",
      source: variable.source
    });
  });

  it("never reports logged-out without a command", () => {
    const denied: AuthObservation = { ...file, reading: { loggedIn: false } };
    expect(resolveAuthState([denied])).toEqual({ status: "unknown" });
    expect(resolveAuthState([])).toEqual({ status: "unknown" });
  });

  it("reads a source that was only checked for existence as logged in", () => {
    const unparsed: AuthObservation = {
      source: { kind: "credential-file", path: "/u/me/.x/auth" }
    };
    expect(resolveAuthState([unparsed])).toEqual({ status: "logged-in", source: unparsed.source });
    const denied: AuthObservation = { ...unparsed, reading: { loggedIn: false } };
    expect(resolveAuthState([denied])).toEqual({ status: "unknown" });
  });
});

describe("envReading", () => {
  it("answers logged in, with the method the variable stands for", () => {
    expect(envReading(undefined)).toEqual({ loggedIn: true });
    expect(envReading("api-key")).toEqual({ loggedIn: true, method: "api-key" });
  });
});

describe("probesAuth", () => {
  it.each([
    ["runnable", true],
    ["found", true],
    ["missing", false],
    ["unknown", false]
  ] as const)("judges no login for an agent that is %s", (status: DetectionStatus, expected: boolean) => {
    expect(probesAuth(status)).toBe(expected);
  });
});
