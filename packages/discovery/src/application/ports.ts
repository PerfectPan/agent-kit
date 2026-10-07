import type { Env, OperatingSystem, PlatformFs, PlatformProcess } from "@rivus/agent-kit-platform";

/**
 * The part of Platform that detection uses: `stat` to check paths, `read` for credential files, `run` for version
 * and login probes, and `env` for `PATH` and authenticating variables. A whole Platform satisfies it, and so does
 * `createMemoryPlatform` from `/testing` with scripted commands.
 */
export interface DiscoveryPlatform {
  readonly env: Env;
  readonly home: string;
  readonly os: OperatingSystem;
  readonly fs: Pick<PlatformFs, "stat" | "read">;
  readonly process: Pick<PlatformProcess, "run">;
}
