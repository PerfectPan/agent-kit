import type { PlatformFs } from "@rivus/agent-kit-platform";

import { type AbsolutePath, formatAbsolutePath, isWithin, parseAbsolutePath } from "../domain/acp-session/index.js";
import { ClientFileError, type ReadTextFile, type WriteTextFile } from "./wire.js";

/** Larger files are refused rather than read whole into memory. */
const MAX_READ_BYTES = 16 * 1024 * 1024;

/** The session directory with its links resolved, or `undefined` when it does not exist. */
export async function sessionRoot(fs: Pick<PlatformFs, "realpath">, cwd: string): Promise<AbsolutePath | undefined> {
  const parsed = parseAbsolutePath(cwd);
  const real = parsed === undefined ? undefined : await fs.realpath(formatAbsolutePath(parsed));
  return real === undefined ? undefined : parseAbsolutePath(real);
}

/**
 * Where a client file call may act: the target with its links resolved, inside the session directory. A target that
 * does not exist yet is judged by its nearest existing parent; a link whose target does not exist is refused, because
 * where it points cannot be checked. The platform resolves `..` the way the file system does, after the links before
 * it, so the check judges the file a call would reach.
 */
async function resolveInside(
  fs: Pick<PlatformFs, "realpath" | "stat">,
  root: AbsolutePath,
  target: string
): Promise<string> {
  const path = parseAbsolutePath(target);
  if (path === undefined) {
    throw new ClientFileError("refused", `${target} is not an absolute path`);
  }
  let resolved = await fs.realpath(formatAbsolutePath(path));
  if (resolved === undefined) {
    if ((await fs.stat(formatAbsolutePath(path)))?.kind === "symlink") {
      throw new ClientFileError("refused", `${target} is a link to a file that does not exist`);
    }
    for (let size = path.parts.length - 1; size >= 0 && resolved === undefined; size -= 1) {
      const parent = await fs.realpath(formatAbsolutePath({ root: path.root, parts: path.parts.slice(0, size) }));
      const real = parent === undefined ? undefined : parseAbsolutePath(parent);
      const rest = path.parts.slice(size);
      if (real !== undefined && rest.includes("..")) {
        throw new ClientFileError("refused", `${target} goes through a directory that does not exist`);
      }
      if (real !== undefined) {
        resolved = formatAbsolutePath({ root: real.root, parts: [...real.parts, ...rest] });
      }
    }
  }
  const inside = resolved === undefined ? undefined : parseAbsolutePath(resolved);
  if (resolved === undefined || inside === undefined || !isWithin(root, inside)) {
    throw new ClientFileError("refused", `${target} is outside the session directory`);
  }
  return resolved;
}

/** `fs/read_text_file`: the file's text, from the 1-based `line` and at most `limit` lines when given. */
export async function readClientFile(
  fs: Pick<PlatformFs, "realpath" | "stat" | "read">,
  root: AbsolutePath,
  request: ReadTextFile
): Promise<string> {
  const path = await resolveInside(fs, root, request.path);
  const stat = await fs.stat(path, { followSymlinks: true });
  if (stat?.kind !== "file") {
    throw new ClientFileError("not-found", request.path);
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new ClientFileError("refused", `${request.path} is larger than ${MAX_READ_BYTES} bytes`);
  }
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of fs.read(path)) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  if (request.line === undefined && request.limit === undefined) {
    return text;
  }
  const lines = text.split("\n");
  const start = Math.max((request.line ?? 1) - 1, 0);
  const end = request.limit === undefined ? lines.length : start + Math.max(request.limit, 0);
  return lines.slice(start, end).join("\n");
}

/** `fs/write_text_file`: replaces the file atomically; a new file needs an existing directory inside the session's. */
export async function writeClientFile(
  fs: Pick<PlatformFs, "realpath" | "stat" | "writeAtomic">,
  root: AbsolutePath,
  request: WriteTextFile
): Promise<void> {
  await fs.writeAtomic(await resolveInside(fs, root, request.path), request.content);
}
