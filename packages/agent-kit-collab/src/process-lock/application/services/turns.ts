import type { ProcessLockPlatform } from "../ports.js";

/** This process's acquisitions of one lock: while it exists, one of them has the turn and the rest wait in order. */
interface Queue {
  readonly waiting: Set<() => void>;
}

/**
 * The queues, by the object that takes the lock (`platform.sqlite`, or without SQLite `platform.fs`), then by the lock's
 * resolved path. In one process, acquisitions exclude each other only through the same SQLite library, which
 * arbitrates between its own connections to a file, or through the same file system; only those share a queue, so
 * platforms over different file systems that reuse a path never wait for each other. Every platform
 * `createNodePlatform` returns shares one `sqlite` and one `fs`. Acquisitions through different objects over the same
 * files still exclude each other in SQLite or the lock file, as two processes do.
 */
const queues = new WeakMap<object, Map<string, Queue>>();

/**
 * The lock's path with its directory resolved as the platform resolves it, against the working directory and through
 * symlinks, so that every spelling of the directory finds one queue. The last component is not followed: a link to the
 * lock file itself gets a queue of its own. A missing directory leaves the path as it is; the attempt then fails.
 */
async function resolvedPath(fs: ProcessLockPlatform["fs"], path: string): Promise<string> {
  const slash = path.lastIndexOf("/");
  const dir = await fs.realpath(slash === -1 ? "." : path.slice(0, slash + 1));
  return dir === undefined ? path : `${dir === "/" ? "" : dir}/${path.slice(slash + 1)}`;
}

/**
 * Takes this process's turn on the lock at `path`. Acquisitions take it one at a time, in the order they reach the
 * queue: while another one has the turn, this one waits in memory, and aborting `signal` meanwhile rejects with
 * `signal.reason` and leaves the others' turns as they were. Without `wait` it resolves to `undefined` at once instead
 * of waiting. The returned function ends the turn and hands it to the next acquisition; the caller calls it once it
 * stops attempting without the lock, or once it has released the lock. Later calls do nothing.
 */
export async function takeTurn(
  platform: ProcessLockPlatform,
  path: string,
  options: { readonly wait: boolean; readonly signal: AbortSignal | undefined }
): Promise<(() => void) | undefined> {
  const { wait, signal } = options;
  const backend = platform.sqlite ?? platform.fs;
  const key = await resolvedPath(platform.fs, path);
  signal?.throwIfAborted();
  const byPath = queues.get(backend) ?? new Map<string, Queue>();
  queues.set(backend, byPath);
  const taken = byPath.get(key);
  if (taken !== undefined && !wait) {
    return undefined;
  }
  const queue = taken ?? { waiting: new Set() };
  let ended = false;
  const end = () => {
    if (ended) {
      return;
    }
    ended = true;
    const next = queue.waiting.values().next();
    if (next.done === true) {
      byPath.delete(key);
    } else {
      queue.waiting.delete(next.value);
      next.value();
    }
  };
  if (taken === undefined) {
    byPath.set(key, queue);
    return end;
  }
  return new Promise((resolve, reject) => {
    // Waking removes the abort listener in the same step, so a waiter either gets the turn or leaves the queue.
    const woken = new AbortController();
    const wake = () => {
      woken.abort();
      resolve(end);
    };
    queue.waiting.add(wake);
    if (signal !== undefined) {
      signal.addEventListener(
        "abort",
        () => {
          queue.waiting.delete(wake);
          reject(signal.reason);
        },
        { once: true, signal: woken.signal }
      );
    }
  });
}
