import { describe, expect, it } from "vite-plus/test";

import type { SessionPlatform } from "../../ports.js";
import { readBytes, readLines } from "./read-file.js";

describe("readBytes", () => {
  it("keeps earlier chunks intact when the producer reuses one Node Buffer", async () => {
    // Node's Buffer#slice returns a view of the same memory, unlike Uint8Array#slice.
    const { Buffer } = globalThis as unknown as { Buffer: { alloc(size: number): Uint8Array } };
    const reused = Buffer.alloc(2);
    const platform: SessionPlatform = {
      fs: {
        async stat() {
          return undefined;
        },
        async list() {
          return [];
        },
        async *read() {
          for (const part of ["aa", "bb"]) {
            reused.set(new TextEncoder().encode(part));
            yield reused;
          }
        }
      }
    };
    expect(new TextDecoder().decode(await readBytes(platform, "/f"))).toBe("aabb");
  });
});

describe("readLines", () => {
  it("stops between chunks once the signal aborts, before a long line ends", async () => {
    const controller = new AbortController();
    let pulled = 0;
    const platform: SessionPlatform = {
      fs: {
        async stat() {
          return undefined;
        },
        async list() {
          return [];
        },
        async *read() {
          for (let index = 0; index < 10; index++) {
            pulled += 1;
            if (index === 1) {
              controller.abort(new Error("stop"));
            }
            yield new TextEncoder().encode("x".repeat(100));
          }
        }
      }
    };
    const consume = async () => {
      for await (const _line of readLines(platform, "/f", { signal: controller.signal })) {
        // A newline-free file yields no line before the abort.
      }
    };
    await expect(consume()).rejects.toThrow("stop");
    expect(pulled).toBe(2);
  });
});
