import { homedir } from "node:os";

import type { Env, OperatingSystem, Platform } from "@rivus/agent-kit-platform";

import { nodeFs } from "./fs.js";
import { createNodeProcess } from "./process.js";
import { nodeSqlite } from "./sqlite.js";

export interface NodePlatformOptions {
  /** Defaults to a frozen snapshot of `process.env` taken when the platform is created. */
  readonly env?: Env;
  /** Defaults to `os.homedir()`. */
  readonly home?: string;
}

/** Creates the Node.js `Platform`. Create it once in the composition root and pass it to use cases. */
export function createNodePlatform(options: NodePlatformOptions = {}): Platform {
  const env = options.env ?? Object.freeze({ ...process.env });
  const os = currentOs();
  return {
    env,
    home: options.home ?? homedir(),
    os,
    fs: nodeFs,
    process: createNodeProcess(env, os),
    clock: { now: Date.now, monotonic: () => performance.now() },
    sqlite: nodeSqlite
  };
}

function currentOs(): OperatingSystem {
  const { platform } = process;
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  throw new Error(`@rivus/agent-kit/node supports darwin, linux and win32, not ${platform}`);
}
