// Session paths use `/`. Node accepts it on Windows too, and agent homes from catalog are spelled with it.

export function joinPath(dir: string, name: string): string {
  if (!dir) {
    return name;
  }
  if (!name) {
    return dir;
  }
  const left = dir.endsWith("/") ? dir.slice(0, -1) : dir;
  const right = name.startsWith("/") ? name.slice(1) : name;
  return `${left}/${right}`;
}

export function basenamePath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

export function dirnamePath(path: string): string {
  const slash = path.lastIndexOf("/");
  if (slash < 0) {
    return ".";
  }
  if (slash === 0) {
    return "/";
  }
  return path.slice(0, slash);
}

/** The path below `root`, the identity of a source whose agent does not move it. */
export function belowRoot(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}
