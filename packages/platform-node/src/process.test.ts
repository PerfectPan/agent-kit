import { tmpdir } from "node:os";

import type { ChildHandle } from "@rivus/agent-kit-platform";
import { afterEach, describe, expect, it } from "vitest";

import { createNodePlatform } from "./create-node-platform.js";

const node = process.execPath;
const PATH = process.env.PATH;
const platform = createNodePlatform({ env: { MARKER: "injected", PATH }, home: tmpdir() });
const cwd = tmpdir();

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

/** Resolves once `text` has appeared on the stream, leaving the rest unread. */
async function waitFor(stream: ReadableStream<Uint8Array>, text: string): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(text)) {
    const { done, value } = await reader.read();
    if (done) {
      throw new Error(`stream ended before ${JSON.stringify(text)}`);
    }
    seen += decoder.decode(value, { stream: true });
  }
  reader.releaseLock();
}

describe("run", () => {
  afterEach(() => {
    delete process.env.MARKER;
  });

  it("reports exit code, stdout and stderr", async () => {
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exitCode = 3';
    expect(await platform.process.run(node, ["-e", script], { timeoutMs: 10_000 })).toEqual({
      code: 3,
      signal: null,
      stdout: "out",
      stderr: "err",
      timedOut: false
    });
  });

  it("uses the injected env by default and an explicit env as the whole environment", async () => {
    process.env.MARKER = "live";
    const script = "process.stdout.write(String(process.env.MARKER))";

    expect((await platform.process.run(node, ["-e", script], { timeoutMs: 10_000 })).stdout).toBe("injected");
    const explicit = await platform.process.run(node, ["-e", script], { env: { OTHER: "1" }, timeoutMs: 10_000 });
    expect(explicit.stdout).toBe("undefined");
  });

  it("kills the command when the timeout fires and reports it", async () => {
    const result = await platform.process.run(node, ["-e", "setTimeout(() => {}, 30_000)"], { timeoutMs: 200 });
    expect(result).toMatchObject({ code: null, signal: "SIGTERM", timedOut: true });
  });

  it("rejects with the abort reason, without spawning when already aborted", async () => {
    const controller = new AbortController();
    const pending = platform.process.run(node, ["-e", "setTimeout(() => {}, 30_000)"], {
      timeoutMs: 30_000,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(new Error("stop")), 100);
    await expect(pending).rejects.toThrow("stop");

    const aborted = AbortSignal.abort(new Error("early"));
    await expect(platform.process.run("missing-command", [], { timeoutMs: 1000, signal: aborted })).rejects.toThrow(
      "early"
    );
  });

  it("rejects when the command cannot be started", async () => {
    await expect(platform.process.run("agent-kit-missing-command", [], { timeoutMs: 1000 })).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not wait for a grandchild that keeps stdout open", async () => {
    const started = performance.now();
    const result = await platform.process.run("sh", ["-c", "sleep 5 & echo hi"], { timeoutMs: 10_000 });
    expect(result).toMatchObject({ code: 0, stdout: "hi\n", timedOut: false });
    expect(performance.now() - started).toBeLessThan(4000);
  });

  it("fails instead of buffering unbounded output", async () => {
    const script = 'process.stdout.write("x".repeat(5 * 1024 * 1024))';
    await expect(platform.process.run(node, ["-e", script], { timeoutMs: 10_000 })).rejects.toThrow("wrote more than");
  });
});

describe("spawn", () => {
  it("round-trips stdin to stdout through Web Streams", async () => {
    const child = platform.process.spawn(node, ["-e", "process.stdin.pipe(process.stdout)"], { cwd, env: {} });
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode("hello\n"));
    await writer.close();

    expect(await readAll(child.stdout)).toBe("hello\n");
    expect(await child.exited).toEqual({ code: 0, signal: null });
  });

  it("S24: passes only the given env, not the parent's or the injected one", async () => {
    process.env.SECRET = "1";
    const child = platform.process.spawn(node, ["-e", "process.stdout.write(JSON.stringify(process.env))"], {
      cwd,
      env: {}
    });
    delete process.env.SECRET;
    const env: Record<string, string> = JSON.parse(await readAll(child.stdout));
    expect(Object.keys(env)).not.toContain("SECRET");
    expect(Object.keys(env)).not.toContain("MARKER");
    expect(Object.keys(env)).not.toContain("PATH");
  });

  it("S24: escalates an abort to SIGKILL for a child that ignores SIGTERM", async () => {
    const controller = new AbortController();
    const script = 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)';
    const child = platform.process.spawn(node, ["-e", script], { cwd, env: {}, signal: controller.signal });
    await waitFor(child.stdout, "ready");

    const started = performance.now();
    controller.abort();
    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(performance.now() - started).toBeGreaterThanOrEqual(1900);
  }, 10_000);

  it("S24: ends a child with SIGTERM on abort and ignores kill() after exit", async () => {
    const controller = new AbortController();
    const child: ChildHandle = platform.process.spawn(node, ["-e", "setInterval(() => {}, 1000)"], {
      cwd,
      env: {},
      signal: controller.signal
    });
    controller.abort();
    expect(await child.exited).toEqual({ code: null, signal: "SIGTERM" });
    child.kill();
    child.kill("SIGKILL");
  });

  it("rejects exited when the command cannot be started", async () => {
    const child = platform.process.spawn("agent-kit-missing-command", [], { cwd, env: { PATH } });
    await expect(child.exited).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("identity", () => {
  it("identifies the current process as self", () => {
    const { self } = platform.process;
    expect(self).toMatchObject({ pid: process.pid, host: expect.any(String), bootId: expect.stringMatching(/\S/) });
    expect(platform.process.identify(process.pid)).toEqual(self);
  });

  it("identifies a running child and returns undefined once it has exited", async () => {
    const script = "console.log(process.pid); setInterval(() => {}, 1000)";
    const child = platform.process.spawn(node, ["-e", script], { cwd, env: {} });
    const pid = Number((await readLine(child.stdout)).trim());
    const identity = platform.process.identify(pid);
    expect(identity).toMatchObject({ pid, bootId: platform.process.self.bootId });
    expect(platform.process.identify(pid)).toEqual(identity);

    child.kill();
    await child.exited;
    expect(platform.process.identify(pid)).toBeUndefined();
  });

  it("treats a zombie and invalid pids as absent", async () => {
    // `exec sleep` replaces the shell without reaping the background child, which stays a zombie until sleep exits.
    const child = platform.process.spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 3"], { cwd, env: { PATH } });
    const zombie = Number((await readLine(child.stdout)).trim());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(platform.process.identify(zombie)).toBeUndefined();
    child.kill("SIGKILL");

    expect(platform.process.identify(0)).toBeUndefined();
    expect(platform.process.identify(-1)).toBeUndefined();
    expect(platform.process.identify(1.5)).toBeUndefined();
  });
});

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value);
}
