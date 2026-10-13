import type { Platform } from "@rivus/agent-kit/platform";

import { acquireProcessLock } from "../../src/process-lock/public.js";
import { testPlatform } from "../support/platform.js";
import { print, stdinLine } from "../support/workers.js";

// Usage: process-lock-worker <path> <sqlite|file> <hold|contend|wait>
//   wait: keeps trying, and prints "waiting" once two attempts have found the lock held.
const [path = "", mechanism, mode] = process.argv.slice(2);
const node = testPlatform({ sqlite: mechanism === "sqlite" });

let attempts = 0;
// Every attempt stamps the holder's identity first, which reads the wall clock once: the third read starts the third
// attempt, so the two before it found the lock held.
const platform: Platform =
  mode === "wait"
    ? {
        ...node,
        clock: {
          now() {
            attempts += 1;
            if (attempts === 3) {
              print("waiting");
            }
            return node.clock.now();
          },
          monotonic: () => node.clock.monotonic()
        }
      }
    : node;

if (mode === "contend") {
  print("ready");
  await stdinLine("go");
}
const result = await acquireProcessLock(platform, path, { wait: mode === "wait", retryMs: 20 });
if (result.ok) {
  print("acquired", { mechanism: result.value.mechanism, pid: process.pid });
  // Hold until killed.
  setInterval(() => undefined, 60_000);
} else {
  print("held", { holderPid: result.error.holder?.pid });
  process.exit(0);
}
