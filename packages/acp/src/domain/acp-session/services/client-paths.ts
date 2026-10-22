import { AbsolutePath } from "../value-objects/absolute-path.js";

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

function resolved(root: AbsolutePath, path: string): ClientPathVerdict {
  const inside = AbsolutePath.parse(path);
  return inside !== undefined && inside.isWithin(root)
    ? { _tag: "resolved", path }
    : { _tag: "refused", reason: "outside-root" };
}

/**
 * Where a client file call may act: the target with its links resolved, inside the session directory. A target that
 * does not exist yet is judged by its nearest existing parent; a link whose target does not exist is refused, because
 * where it points cannot be checked, and so is a `..` that crosses a directory that does not exist. The platform
 * resolves `..` the way the file system does, after the links before it, so the verdict judges the file a call would
 * reach.
 */
export function clientPathVerdict(root: AbsolutePath, target: AbsolutePath, facts: ClientPathFacts): ClientPathVerdict {
  const spelling = target.format();
  const self = facts.realpaths.get(spelling);
  if (self !== undefined) {
    return resolved(root, self);
  }
  if (facts.targetIsSymlink) {
    return { _tag: "refused", reason: "dangling-link" };
  }
  for (let size = target.parts.length - 1; size >= 0; size -= 1) {
    const parent = facts.realpaths.get(target.prefix(size).format());
    const real = parent === undefined ? undefined : AbsolutePath.parse(parent);
    if (real === undefined) {
      continue;
    }
    const rest = target.parts.slice(size);
    if (rest.includes("..")) {
      return { _tag: "refused", reason: "unresolved-directory" };
    }
    return resolved(root, real.append(rest).format());
  }
  return { _tag: "refused", reason: "outside-root" };
}
