import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { hostname } from "node:os";
import { Readable, Writable } from "node:stream";

import type {
  ChildHandle,
  Env,
  ExitStatus,
  OperatingSystem,
  PlatformProcess,
  ProcessIdentity,
  RunOptions,
  RunResult,
  SpawnOptions
} from "@rivus/agent-kit-platform";

import { createIdentify } from "./process-identity.js";

/** How long an aborted or timed-out child may take to exit after SIGTERM before it gets SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** Per stream. `run` is for short commands, so more output than this fails the run instead of being truncated. */
const MAX_RUN_OUTPUT_BYTES = 4 * 1024 * 1024;
/** Node's own code for the same failure in `execFile`, so callers can tell it from a failure to start. */
const OUTPUT_LIMIT_CODE = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
/** How long a `run` grandchild that inherited stdout or stderr may hold them open after the child exits. */
const STDIO_DRAIN_MS = 1_000;
/** Larger `setTimeout` delays overflow and fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

function isRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function terminate(child: ChildProcess): void {
  if (!isRunning(child)) {
    return;
  }
  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (isRunning(child)) {
      child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS);
  child.once("exit", () => clearTimeout(escalation));
}

function collect(stream: Readable, onOverflow: () => void): () => string {
  const chunks: Buffer[] = [];
  let size = 0;
  stream.on("data", (chunk: Buffer) => {
    size += chunk.byteLength;
    if (size > MAX_RUN_OUTPUT_BYTES) {
      onOverflow();
    } else {
      chunks.push(chunk);
    }
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

function run(command: string, args: readonly string[], options: RunOptions, defaultEnv: Env): Promise<RunResult> {
  const { signal } = options;
  if (signal?.aborted === true) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const child = spawnChild(command, args, {
      cwd: options.cwd,
      env: options.env ?? defaultEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let failure: unknown;
    let timedOut = false;
    let stopped = false;
    let drain: NodeJS.Timeout | undefined;
    const stop = () => {
      if (!stopped) {
        stopped = true;
        terminate(child);
      }
    };
    const overflow = (stream: string) => () => {
      failure ??= Object.assign(new Error(`${command} wrote more than ${MAX_RUN_OUTPUT_BYTES} bytes to ${stream}`), {
        code: OUTPUT_LIMIT_CODE
      });
      stop();
    };
    const stdout = collect(child.stdout, overflow("stdout"));
    const stderr = collect(child.stderr, overflow("stderr"));
    const timer = setTimeout(
      () => {
        timedOut = true;
        stop();
      },
      Math.min(options.timeoutMs, MAX_TIMER_MS)
    );
    signal?.addEventListener("abort", stop, { once: true });

    // A spawn failure emits "error" and then "close", without "exit".
    child.on("error", (error) => {
      failure ??= error;
    });
    child.once("exit", () => {
      clearTimeout(timer);
      drain = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, STDIO_DRAIN_MS);
    });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(drain);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted === true) {
        reject(signal.reason);
      } else if (failure !== undefined) {
        reject(failure);
      } else {
        resolve({ code, signal: exitSignal, stdout: stdout(), stderr: stderr(), timedOut });
      }
    });
  });
}

function spawn(command: string, args: readonly string[], options: SpawnOptions): ChildHandle {
  const { signal } = options;
  const child = spawnChild(command, args, { cwd: options.cwd, env: options.env, stdio: "pipe", windowsHide: true });
  const exited = new Promise<ExitStatus>((resolve, reject) => {
    child.on("error", (error) => {
      if (child.pid === undefined) {
        reject(error);
      }
    });
    child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  // A caller that never awaits `exited` must not get an unhandled rejection for a failed spawn.
  exited.catch(() => undefined);
  if (signal !== undefined) {
    const abort = () => terminate(child);
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
      child.once("close", () => signal.removeEventListener("abort", abort));
    }
  }
  // The casts are for compilations that include lib.dom, whose stream types @types/node declares separately.
  return {
    stdin: Writable.toWeb(child.stdin) as ChildHandle["stdin"],
    stdout: Readable.toWeb(child.stdout) as ChildHandle["stdout"],
    stderr: Readable.toWeb(child.stderr) as ChildHandle["stderr"],
    exited,
    kill(killSignal = "SIGTERM") {
      if (isRunning(child)) {
        child.kill(killSignal);
      }
    }
  };
}

export function createNodeProcess(env: Env, os: OperatingSystem): PlatformProcess {
  const identify = createIdentify(os);
  let host: string | undefined;
  function requiredIdentity(): ProcessIdentity {
    const identity = identify(process.pid);
    if (identity === undefined) {
      throw new Error(`Could not identify the current process ${process.pid}`);
    }
    return identity;
  }
  // Boot id and start time are read only when those fields are read. Host and pid need no child process, so a caller
  // that records them alone (a SQLite lock stamp) does not spawn sysctl or ps. win32 has no identity either way.
  const fields = {
    get host() {
      if (os === "win32") {
        throw new Error("Process identity (boot id and start time) is not supported on win32");
      }
      host ??= hostname();
      return host;
    },
    get pid() {
      return process.pid;
    },
    get bootId() {
      return requiredIdentity().bootId;
    },
    get startTime() {
      return requiredIdentity().startTime;
    }
  } satisfies ProcessIdentity;
  return {
    run: (command, args, options) => run(command, args, options, env),
    spawn,
    // `self` itself throws on win32. Returning the lazy object would defer that until a field is read.
    get self() {
      if (os === "win32") {
        throw new Error("Process identity (boot id and start time) is not supported on win32");
      }
      return fields;
    },
    identify
  };
}
