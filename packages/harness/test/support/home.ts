import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import { createNodePlatform } from "@rivus/agent-kit-platform-node";
import * as Layer from "effect/Layer";

import { HarnessLive } from "../../src/infra/factories/harness-live.js";
import type { HarnessServices } from "../../src/application/use-cases/plan-install.js";

const homes: string[] = [];

/**
 * A throwaway home with an explicit environment: HOME points at it, PATH holds only its own `bin` (empty unless a test
 * puts fake agent commands there), and nothing else from the real environment, so no test reads or writes a real
 * agent home.
 */
export interface TestHome {
  readonly home: string;
  readonly bin: string;
  readonly env: Readonly<Record<string, string>>;
  readonly platform: Platform;
  path(relative: string): string;
  write(relative: string, content: string): void;
  read(relative: string): string | undefined;
  /** A Node script on the home's PATH under `name`. */
  command(name: string, script: string): void;
  layer(platform?: Platform): Layer.Layer<HarnessServices>;
}

export function testHome(extraEnv: Readonly<Record<string, string>> = {}): TestHome {
  // realpath: macOS's temporary directory is behind a symlink, and planned paths are resolved.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "agent-kit-harness-")));
  homes.push(home);
  const bin = join(home, "bin");
  mkdirSync(bin);
  const env = { HOME: home, PATH: bin, ...extraEnv };
  const platform = createNodePlatform({ env, home });
  const path = (relative: string) => join(home, relative);
  return {
    home,
    bin,
    env,
    platform,
    path,
    write(relative, content) {
      mkdirSync(dirname(path(relative)), { recursive: true });
      writeFileSync(path(relative), content);
    },
    read(relative) {
      try {
        return readFileSync(path(relative), "utf8");
      } catch {
        return undefined;
      }
    },
    command(name, script) {
      writeFileSync(join(bin, name), `#!${process.execPath}\n${script}`);
      chmodSync(join(bin, name), 0o755);
    },
    layer: (override = platform) => HarnessLive.pipe(Layer.provideMerge(Layer.succeed(PlatformService, override)))
  };
}

export function removeTestHomes(): void {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
}
