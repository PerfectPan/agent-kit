import { describe, expect, it } from "vite-plus/test";
import { detectAgents, type DetectAgentsOptions, type Installation } from "@rivus/agent-kit-discovery";
import {
  createMemoryPlatform,
  type MemoryPlatform,
  type MemoryPlatformOptions,
  type MemoryRunResult
} from "@rivus/agent-kit-testing";
import { cursor } from "../src/identity.js";
import { cursorProbe } from "../src/discovery.js";

const HOME = "/u/me";
const testDiscovery = { cursor: cursorProbe };
const testIdentity = { cursor };
const commands = { authProbe: "commands" } as const;
function machine(options: MemoryPlatformOptions = {}): MemoryPlatform {
  return createMemoryPlatform({
    home: HOME,
    ...options,
    env: { PATH: "/opt/bin", ...options.env },
    files: { [`${HOME}/.profile`]: "", ...options.files }
  });
}
async function detectOne(
  platform: MemoryPlatform,
  agent: string,
  options: Omit<DetectAgentsOptions, "agents" | "providers"> = {}
): Promise<Installation> {
  const [installation] = await detectAgents(platform, {
    ...options,
    agents: [agent],
    providers: { discovery: testDiscovery, identity: testIdentity }
  });
  if (installation === undefined) {
    throw new Error(`no installation for ${agent}`);
  }
  return installation;
}

describe("Cursor discovery", () => {
  it("reads Cursor's CLI status from its output, since it exits with 0 when logged out", async () => {
    const status = (value: string): MemoryRunResult => ({ code: 0, stdout: JSON.stringify({ status: value }) });
    const platform = (value: string) =>
      machine({
        files: { "/Applications/Cursor.app/Contents/Info.plist": "" },
        commands: { "/opt/bin/cursor-agent": (args) => (args[0] === "status" ? status(value) : { code: 2 }) }
      });
    expect((await detectOne(platform("unauthenticated"), "cursor", commands)).auth).toEqual({
      status: "logged-out",
      source: { kind: "command", command: "/opt/bin/cursor-agent", args: ["status", "--format", "json"] }
    });
    expect((await detectOne(platform("authenticated"), "cursor", commands)).auth).toMatchObject({
      status: "logged-in"
    });
  });

  it.each([".config/cursor/auth.json", "AppData/Roaming/Cursor/auth.json"])(
    "counts Cursor's credential file %s",
    async (path) => {
      const platform = machine({ files: { [`${HOME}/${path}`]: "{}" } });
      const [installation] = await detectAgents(platform, {
        agents: ["cursor"],
        versionProbe: false,
        providers: { discovery: testDiscovery, identity: testIdentity }
      });
      expect(installation).toMatchObject({
        status: "found",
        evidence: [{ kind: "config", path: `${HOME}/${path}` }],
        problems: []
      });
    }
  );
});
