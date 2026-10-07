import type { CommandFailed, CommandOutput } from "../domain/installation/index.js";
import { errnoCode } from "./abortable.js";
import type { DiscoveryPlatform } from "./ports.js";

/** The platform's code for a command that printed more than it collects. */
const OUTPUT_LIMIT_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/**
 * Windows runs `.cmd` and `.bat` files only through `cmd.exe`, and Node refuses to spawn them without a shell. npm
 * installs agents as such shims, so on Windows they are found but never run.
 */
export function isShellShim(platform: Pick<DiscoveryPlatform, "os">, path: string): boolean {
  return platform.os === "win32" && /\.(?:cmd|bat)$/i.test(path);
}

export interface ProbeCommand<T> {
  readonly purpose: CommandFailed["purpose"];
  readonly path: string;
  readonly args: readonly string[];
  readonly parse: (output: CommandOutput) => T | undefined;
}

/**
 * Runs a probe command without a shell, with the platform's environment, and parses what it printed. It runs in the
 * user's home directory, so agent settings in the caller's working directory cannot change what the command does. A
 * Windows shell shim is not run. A command that cannot start (a spawn error with an errno `code`), times out, prints
 * too much or prints something its parser does not recognize is a `CommandFailed`; any other rejection is a defect
 * and rejects, and an abort rejects with `signal.reason`.
 */
export async function runProbe<T>(
  platform: Pick<DiscoveryPlatform, "home" | "os" | "process">,
  probe: ProbeCommand<T>,
  options: { readonly timeoutMs: number; readonly signal: AbortSignal | undefined }
): Promise<{ readonly value: T } | { readonly problem: CommandFailed }> {
  const { purpose, path, args } = probe;
  const failed = (
    reason: CommandFailed["reason"],
    detail: Pick<CommandFailed, "exitCode" | "message"> = {}
  ): { readonly problem: CommandFailed } => ({
    problem: { _tag: "CommandFailed", purpose, path, args, reason, ...detail }
  });
  if (isShellShim(platform, path)) {
    return failed("shell-shim-not-run");
  }
  let output: CommandOutput;
  try {
    const result = await platform.process.run(path, args, {
      cwd: platform.home,
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {})
    });
    if (result.timedOut) {
      return failed("timed-out");
    }
    output = { code: result.code, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    options.signal?.throwIfAborted();
    const code = (error as { code?: unknown } | null)?.code;
    if (code === OUTPUT_LIMIT_CODE) {
      return failed("output-too-large");
    }
    if (errnoCode(error) === undefined) {
      throw error;
    }
    return failed("start-failed", { message: error instanceof Error ? error.message : String(error) });
  }
  const value = probe.parse(output);
  return value === undefined ? failed("unrecognized", { exitCode: output.code }) : { value };
}
