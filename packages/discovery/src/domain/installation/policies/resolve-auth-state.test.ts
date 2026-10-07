import { describe, expect, it } from "vitest";

import type { AuthObservation } from "../value-objects/auth-state.js";
import { resolveAuthState } from "./resolve-auth-state.js";

const command = (loggedIn: boolean, method?: string): AuthObservation => ({
  source: { kind: "command", command: "/bin/x", args: ["status"] },
  reading: method === undefined ? { loggedIn } : { loggedIn, method }
});
const file: AuthObservation = {
  source: { kind: "credential-file", path: "/u/me/.x/auth" },
  reading: { loggedIn: true }
};
const variable: AuthObservation = { source: { kind: "env", variable: "X_KEY" }, reading: { loggedIn: true } };

describe("resolveAuthState", () => {
  it("lets the status command decide, even against stored credentials", () => {
    expect(resolveAuthState([file, command(false)])).toEqual({ status: "logged-out", source: command(false).source });
    expect(resolveAuthState([variable, command(true, "api-key")])).toEqual({
      status: "logged-in",
      method: "api-key",
      source: command(true).source
    });
  });

  it("counts stored credentials as logged in, in observation order", () => {
    expect(resolveAuthState([variable, file])).toEqual({ status: "logged-in", source: variable.source });
  });

  it("never reports logged-out without a command", () => {
    const denied: AuthObservation = { ...file, reading: { loggedIn: false } };
    expect(resolveAuthState([denied])).toEqual({ status: "unknown" });
    expect(resolveAuthState([])).toEqual({ status: "unknown" });
  });
});
