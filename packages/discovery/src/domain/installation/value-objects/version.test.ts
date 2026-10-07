import { describe, expect, it } from "vitest";

import { versionFromOutput } from "./version.js";

describe("versionFromOutput", () => {
  it("reads trimmed standard output and its first version number", () => {
    expect(versionFromOutput({ code: 0, stdout: " codex-cli 0.154.0\n", stderr: "WARNING: 9.9.9" })).toEqual({
      output: "codex-cli 0.154.0",
      number: "0.154.0"
    });
    expect(versionFromOutput({ code: 0, stdout: "tool v2.0.0-beta.1 (abc)", stderr: "" })?.number).toBe("2.0.0-beta.1");
    expect(versionFromOutput({ code: 0, stdout: "nightly", stderr: "" })).toEqual({ output: "nightly" });
  });

  it("reads nothing from a failed command or a blank output", () => {
    expect(versionFromOutput({ code: 1, stdout: "x 1.0.0", stderr: "" })).toBeUndefined();
    expect(versionFromOutput({ code: null, stdout: "x 1.0.0", stderr: "" })).toBeUndefined();
    expect(versionFromOutput({ code: 0, stdout: " \n", stderr: "x 1.0.0" })).toBeUndefined();
  });
});
