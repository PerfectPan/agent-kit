import { describe, expect, it } from "vite-plus/test";

import type { Evidence } from "../value-objects/evidence.js";
import type { ProbeProblem } from "../value-objects/probe-problem.js";
import { classifyInstallation } from "./classify-installation.js";

const command: Evidence = { kind: "command", command: "x", path: "/bin/x" };
const version: Evidence = { kind: "version", path: "/bin/x", args: ["--version"], version: { output: "x 1.0" } };
const config: Evidence = { kind: "config", path: "/u/me/.x" };
const unreadable: ProbeProblem = { _tag: "StatFailed", path: "/u/me/.x", code: "EACCES" };
const timedOut: ProbeProblem = {
  _tag: "CommandFailed",
  purpose: "version",
  path: "/bin/x",
  args: ["--version"],
  reason: "timed-out"
};

describe("classifyInstallation", () => {
  it.each([
    ["runnable", [command, version, config], []],
    ["runnable", [config, version, command], [timedOut]],
    ["found", [command], [timedOut]],
    ["found", [config], [unreadable]],
    ["missing", [], []],
    ["unknown", [], [unreadable]]
  ] as const)("is %s for %j with problems %j", (status, evidence, problems) => {
    expect(classifyInstallation(evidence, problems)).toBe(status);
  });
});
