import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createNodePlatform } from "@rivus/agent-kit/node";
import type { Platform, PlatformClock } from "@rivus/agent-kit/platform";

/** The Node platform with an empty environment and a home that does not exist, so no test reads a real agent home. */
export function testPlatform(options: { readonly sqlite?: boolean } = {}): Platform {
  const platform = createNodePlatform({ env: {}, home: "/nonexistent-home" });
  return options.sqlite === false ? { ...platform, sqlite: undefined } : platform;
}

/**
 * The platform as a process that may not identify itself or others sees it, such as one on darwin in a sandbox that
 * denies running `ps` and `sysctl`: `process.self` and `process.identify` throw, each after calling `onRead`.
 */
export function withoutIdentity(platform: Platform, onRead: () => void = () => undefined): Platform {
  const { process: node } = platform;
  const fail = (): never => {
    onRead();
    throw new Error("cannot identify processes here");
  };
  return {
    ...platform,
    // Built member by member: spreading the Node port would read its `self` getter.
    process: {
      run: (command, args, options) => node.run(command, args, options),
      spawn: (command, args, options) => node.spawn(command, args, options),
      get self(): never {
        return fail();
      },
      identify: fail
    }
  };
}

export interface ManualClock {
  /** Both readings start at 0 and move only with `advance`. */
  readonly clock: PlatformClock;
  advance(ms: number): void;
  /** Resolves at the next read of the monotonic clock: the code under test has started or checked a deadline. */
  nextRead(): Promise<void>;
}

/** A platform clock that stands still until the test moves it. */
export function manualClock(): ManualClock {
  let now = 0;
  const readers: (() => void)[] = [];
  return {
    clock: {
      now: () => now,
      monotonic: () => {
        for (const resolve of readers.splice(0)) {
          resolve();
        }
        return now;
      }
    },
    advance(ms) {
      now += ms;
    },
    nextRead: () =>
      new Promise((resolve) => {
        readers.push(resolve);
      })
  };
}

const dirs: string[] = [];

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-kit-collab-"));
  dirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
