/**
 * Settles like `promise`, or rejects with `signal.reason` as soon as `signal` aborts, so a platform call that hangs
 * (a stalled network mount) cannot hold detection past an abort. The call itself is not cancelled.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/**
 * An errno code such as `ENOENT`, or libuv's `UNKNOWN` for an error it cannot map; `undefined` for an error that is
 * not a file system or spawn failure.
 */
export function errnoCode(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && (code === "UNKNOWN" || /^E[A-Z0-9]+$/.test(code)) ? code : undefined;
}
