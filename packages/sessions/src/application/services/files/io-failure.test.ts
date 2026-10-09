import { describe, expect, it } from "vitest";

import type { SessionPlatform } from "../../ports.js";
import { catchIoFailure } from "./io-failure.js";

/** A platform whose every file system call throws the error a case builds. */
const throwing = (make: () => unknown): SessionPlatform => ({
  fs: {
    stat: () => Promise.reject(make()),
    list: () => Promise.reject(make()),
    read: () => {
      throw make();
    }
  }
});

const read = async (platform: SessionPlatform) =>
  catchIoFailure(platform, "/caller/path", undefined, async (guarded) => {
    await guarded.fs.stat("/x");
    return 1;
  });

/** An error with a property whose getter throws, like a proxy error a host may hand over. */
const getterThrows = (error: Error, key: string): Error => {
  Object.defineProperty(error, key, {
    get() {
      throw new Error(`getter ${key}`);
    },
    configurable: true
  });
  return error;
};

describe("catchIoFailure", () => {
  it("turns ENOENT into SessionNotFound and another errno into ReadFailed at the error's or caller's path", async () => {
    const notFound = await read(throwing(() => Object.assign(new Error("no"), { code: "ENOENT" })));
    expect(notFound).toStrictEqual({ ok: false, error: { _tag: "SessionNotFound", path: "/caller/path" } });

    const denied = await read(throwing(() => Object.assign(new Error("no"), { code: "EACCES", path: "/on/error" })));
    expect(denied).toStrictEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: "/on/error", message: "no", cause: expect.any(Error) }
    });

    const plain = await read(throwing(() => ({ code: "EISDIR" })));
    expect(plain).toStrictEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: "/caller/path", message: "EISDIR", cause: expect.anything() }
    });
  });

  it("keeps a code that stringifies to an errno, judged by the same strict comparison as before", async () => {
    const byObject = await read(throwing(() => Object.assign(new Error("s"), { code: new String("EACCES") })));
    expect(byObject).toStrictEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: "/caller/path", message: "s", cause: expect.anything() }
    });

    const byArray = await read(throwing(() => Object.assign(new Error("a"), { code: ["ENOENT"] })));
    expect(byArray).toStrictEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: "/caller/path", message: "a", cause: expect.anything() }
    });
  });

  it("marks the error of a file read too, through the guarded generator's catch", async () => {
    const failure = await catchIoFailure(
      throwing(() => Object.assign(new Error("io"), { code: "EIO" })),
      "/caller/path",
      undefined,
      async (guarded) => {
        let bytes = 0;
        for await (const chunk of guarded.fs.read("/x")) {
          bytes += chunk.length;
        }
        return bytes;
      }
    );
    expect(failure).toStrictEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: "/caller/path", message: "io", cause: expect.anything() }
    });
  });

  it("rethrows a defect untouched, including one whose code getter throws on the way out", async () => {
    const defect = new Error("defect");
    await expect(read(throwing(() => defect))).rejects.toBe(defect);

    const guarded = getterThrows(new Error("guarded"), "code");
    await expect(
      catchIoFailure(
        throwing(() => 1),
        "/caller/path",
        undefined,
        async () => {
          throw guarded;
        }
      )
    ).rejects.toBe(guarded);
  });

  it("reads a marked error's properties at classification, where a throwing getter surfaced before too", async () => {
    const marked = getterThrows(Object.assign(new Error("p"), { code: "ENOENT" }), "path");
    await expect(read(throwing(() => marked))).rejects.toThrow("getter path");

    // An unmarked error keeps every other property unread: marking reads only `code`, and the membership check is
    // first — so a throwing `path` getter cannot replace the original throw.
    const unmarkedPath = getterThrows(Object.assign(new Error("x"), { code: "ERR_X" }), "path");
    await expect(read(throwing(() => unmarkedPath))).rejects.toBe(unmarkedPath);

    // A throwing `code` getter surfaces from the marking read itself, exactly as it did before.
    const unmarkedCode = getterThrows(new Error("x"), "code");
    await expect(read(throwing(() => unmarkedCode))).rejects.toThrow("getter code");
  });
});
