import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("resolve-ts.ts", import.meta.url));

/** One JSON line a worker printed. */
export interface WorkerLine {
  readonly event: string;
  readonly at: number;
  readonly [field: string]: unknown;
}

export interface Worker {
  readonly pid: number;
  readonly lines: readonly WorkerLine[];
  /** The first line, already printed or still to come, with this event. */
  next(event: string, timeoutMs?: number): Promise<WorkerLine>;
  send(line: string): void;
  signal(signal: NodeJS.Signals): void;
  readonly exited: Promise<number | null>;
}

const running = new Set<ChildProcess>();

/** Starts `test/workers/<name>.ts` in its own Node process. `stopWorkers` kills whatever is left. */
export function startWorker(name: string, args: readonly string[]): Worker {
  const script = fileURLToPath(new URL(`../workers/${name}.ts`, import.meta.url));
  const child = spawn(process.execPath, ["--import", hook, script, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH ?? "" }
  });
  running.add(child);
  const lines: WorkerLine[] = [];
  const waiters = new Set<() => void>();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  createInterface({ input: child.stdout }).on("line", (text) => {
    lines.push({ ...(JSON.parse(text) as { event: string }), at: performance.now() });
    for (const waiter of waiters) {
      waiter();
    }
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => {
      running.delete(child);
      resolve(code);
      for (const waiter of waiters) {
        waiter();
      }
    });
  });
  if (child.pid === undefined) {
    throw new Error(`cannot start ${name}`);
  }
  return {
    pid: child.pid,
    lines,
    exited,
    next(event, timeoutMs = 10_000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const line = lines.find((candidate) => candidate.event === event);
          if (line !== undefined) {
            cleanup();
            resolve(line);
          } else if (child.exitCode !== null || child.signalCode !== null) {
            cleanup();
            reject(new Error(`${name} exited before "${event}": ${JSON.stringify(lines)}\n${stderr}`));
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`${name} printed no "${event}" in ${timeoutMs} ms: ${JSON.stringify(lines)}\n${stderr}`));
        }, timeoutMs);
        function cleanup() {
          clearTimeout(timer);
          waiters.delete(check);
        }
        waiters.add(check);
        check();
      });
    },
    send(line) {
      child.stdin.write(`${line}\n`);
    },
    signal(signal) {
      child.kill(signal);
    }
  };
}

export async function stopWorkers(): Promise<void> {
  const children = [...running];
  for (const child of children) {
    child.kill("SIGKILL");
  }
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("exit", resolve))
    )
  );
}

/** Resolves on the first stdin line equal to `text`. */
export function stdinLine(text: string): Promise<void> {
  return new Promise((resolve) => {
    const reader = createInterface({ input: process.stdin });
    reader.on("line", (line) => {
      if (line === text) {
        reader.close();
        resolve();
      }
    });
  });
}

export function print(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}
