import { isProcessLockHeld } from "../../src/process-lock/public.js";
import { testPlatform } from "../support/platform.js";
import { print, stdinLine } from "../support/workers.js";

// Usage: process-lock-check-worker <path> <sqlite|file> <burst|loop|share> [checks]
//   burst: prints "ready", waits for "go", runs [checks] checks back to back, prints "checked".
//   loop: checks until stdin says "stop", then prints "checked"; prints "checking" after the first check and
//     "saw-held" after the first one that found the lock held.
//   share: holds a shared lock on the database, as a check does for one statement, until killed.
const [path = "", mechanism, mode, checks = "1"] = process.argv.slice(2);
const platform = testPlatform({ sqlite: mechanism === "sqlite" });

if (mode === "burst") {
  print("ready");
  await stdinLine("go");
  let held = 0;
  for (let check = 0; check < Number(checks); check += 1) {
    held += (await isProcessLockHeld(platform, path)) ? 1 : 0;
  }
  print("checked", { count: Number(checks), held });
  process.exit(0);
}

if (mode === "loop") {
  let stop = false;
  void stdinLine("stop").then(() => {
    stop = true;
  });
  let count = 0;
  let sawHeld = false;
  while (!stop) {
    const held = await isProcessLockHeld(platform, path);
    count += 1;
    if (count === 1) {
      print("checking");
    }
    if (held && !sawHeld) {
      sawHeld = true;
      print("saw-held");
    }
    // Lets the stdin line in between checks.
    await new Promise((resolve) => setImmediate(resolve));
  }
  print("checked", { count });
  process.exit(0);
}

if (mode === "share" && platform.sqlite !== undefined) {
  const db = platform.sqlite.open(path, { readonly: true });
  db.exec("BEGIN");
  db.exec("PRAGMA schema_version");
  print("sharing");
  // Hold until killed.
  setInterval(() => undefined, 60_000);
}
