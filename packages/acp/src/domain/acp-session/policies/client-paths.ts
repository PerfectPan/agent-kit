// Paths of the client file system calls an agent makes. ACP paths are absolute; the session directory and every
// target are compared after the platform resolves links, and these functions only split and compare spellings. They
// keep `..`: only the platform can resolve it, after the links before it (`link/..` is the link target's parent).

/** An absolute path as its root (`/`, or a drive such as `C:\`) and its parts, without empty and `.` parts. */
export interface AbsolutePath {
  readonly root: string;
  readonly parts: readonly string[];
}

const DRIVE = /^[A-Za-z]:[\\/]/;

/** `undefined` for a relative path, which names no place the session chose. */
export function parseAbsolutePath(path: string): AbsolutePath | undefined {
  let root: string;
  let rest: string;
  let separator: RegExp;
  if (path.startsWith("/")) {
    root = "/";
    rest = path.slice(1);
    separator = /\/+/;
  } else if (DRIVE.test(path)) {
    root = `${path.slice(0, 2).toUpperCase()}\\`;
    rest = path.slice(3);
    separator = /[\\/]+/;
  } else {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of rest.split(separator)) {
    if (part !== "" && part !== ".") {
      parts.push(part);
    }
  }
  return { root, parts };
}

export function formatAbsolutePath(path: AbsolutePath): string {
  return path.root === "/" ? `/${path.parts.join("/")}` : `${path.root}${path.parts.join("\\")}`;
}

/**
 * Whether the resolved `path` is `root` or below it. A path that still has a `..` part is never within; a name that
 * only starts with `..`, such as `..notes`, is an ordinary name.
 */
export function isWithin(root: AbsolutePath, path: AbsolutePath): boolean {
  return (
    !path.parts.includes("..") &&
    root.root === path.root &&
    root.parts.length <= path.parts.length &&
    root.parts.every((part, index) => part === path.parts[index])
  );
}

/** Why a client file call may not act on its target. */
export type ClientPathRefusal = "dangling-link" | "unresolved-directory" | "outside-root";

/** Where a client file call may act: the target's resolved spelling, or why it is refused. */
export type ClientPathVerdict =
  | { readonly _tag: "resolved"; readonly path: string }
  | { readonly _tag: "refused"; readonly reason: ClientPathRefusal };

/** What the file system says about a target and its parent directories, before the verdict is judged. */
export interface ClientPathFacts {
  /**
   * The link-resolved spellings the platform answered for, keyed by each prefix's own spelling. The verdict judges a
   * missing target by its nearest existing parent, so a caller may stop probing there; a prefix that is unresolved
   * or was not probed is absent.
   */
  readonly realpaths: ReadonlyMap<string, string>;
  /** Whether the target names a symlink, recorded only when its own realpath did not resolve. */
  readonly targetIsSymlink: boolean;
}

/**
 * Where a client file call may act: the target with its links resolved, inside the session directory. A target that
 * does not exist yet is judged by its nearest existing parent; a link whose target does not exist is refused, because
 * where it points cannot be checked, and so is a `..` that crosses a directory that does not exist. The platform
 * resolves `..` the way the file system does, after the links before it, so the verdict judges the file a call would
 * reach.
 */
export function clientPathVerdict(root: AbsolutePath, target: AbsolutePath, facts: ClientPathFacts): ClientPathVerdict {
  const spelling = formatAbsolutePath(target);
  const self = facts.realpaths.get(spelling);
  if (self !== undefined) {
    return resolved(root, self);
  }
  if (facts.targetIsSymlink) {
    return { _tag: "refused", reason: "dangling-link" };
  }
  for (let size = target.parts.length - 1; size >= 0; size -= 1) {
    const parent = facts.realpaths.get(formatAbsolutePath({ root: target.root, parts: target.parts.slice(0, size) }));
    const real = parent === undefined ? undefined : parseAbsolutePath(parent);
    if (real === undefined) {
      continue;
    }
    const rest = target.parts.slice(size);
    if (rest.includes("..")) {
      return { _tag: "refused", reason: "unresolved-directory" };
    }
    return resolved(root, formatAbsolutePath({ root: real.root, parts: [...real.parts, ...rest] }));
  }
  return { _tag: "refused", reason: "outside-root" };
}

function resolved(root: AbsolutePath, path: string): ClientPathVerdict {
  const inside = parseAbsolutePath(path);
  return inside !== undefined && isWithin(root, inside)
    ? { _tag: "resolved", path }
    : { _tag: "refused", reason: "outside-root" };
}
