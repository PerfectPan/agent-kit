import type { PlatformFs } from "@rivus/agent-kit-platform";

import {
  type AbsolutePath,
  type ClientPathRefusal,
  clientPathVerdict,
  formatAbsolutePath,
  parseAbsolutePath
} from "../../domain/acp-session/index.js";
import { ClientFileError, type ReadTextFile, type WriteTextFile } from "./wire.js";

/** Larger files are refused rather than read whole into memory. */
const MAX_READ_BYTES = 16 * 1024 * 1024;

/** The session directory with its links resolved, or `undefined` when it does not exist. */
export async function sessionRoot(fs: Pick<PlatformFs, "realpath">, cwd: string): Promise<AbsolutePath | undefined> {
  const parsed = parseAbsolutePath(cwd);
  const real = parsed === undefined ? undefined : await fs.realpath(formatAbsolutePath(parsed));
  return real === undefined ? undefined : parseAbsolutePath(real);
}

const REFUSED: Record<ClientPathRefusal, string> = {
  "dangling-link": "is a link to a file that does not exist",
  "unresolved-directory": "goes through a directory that does not exist",
  "outside-root": "is outside the session directory"
};

/**
 * Where a client file call may act: the target with its links resolved, inside the session directory. The platform
 * answers for the target and every parent prefix, and the domain's `clientPathVerdict` judges the answers.
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
  const realpaths = new Map<string, string>();
  for (let size = path.parts.length; size >= 0; size -= 1) {
    const prefix = formatAbsolutePath({ root: path.root, parts: path.parts.slice(0, size) });
    const real = await fs.realpath(prefix);
    if (real !== undefined) {
      realpaths.set(prefix, real);
    }
  }
  // A target the platform resolved exists; only a missing one can be a link to a file that does not exist.
  const targetIsSymlink = realpaths.has(formatAbsolutePath(path))
    ? false
    : (await fs.stat(formatAbsolutePath(path)))?.kind === "symlink";
  const verdict = clientPathVerdict(root, path, { realpaths, targetIsSymlink });
  if (verdict._tag === "refused") {
    throw new ClientFileError("refused", `${target} ${REFUSED[verdict.reason]}`);
  }
  return verdict.path;
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
