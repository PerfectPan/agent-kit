import { acquireProcessLock } from "../../src/process-lock/public.js";
import { testPlatform } from "../support/platform.js";
import { print, stdinLine } from "../support/workers.js";

// Usage: process-lock-worker <path> <sqlite|file> <hold|contend|wait>
const [path = "", mechanism, mode] = process.argv.slice(2);
const platform = testPlatform({ sqlite: mechanism === "sqlite" });

if (mode === "contend") {
  print("ready");
  await stdinLine("go");
}
if (mode === "wait") {
  print("waiting");
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
