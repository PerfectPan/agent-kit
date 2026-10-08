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
