/**
 * Why a step cannot proceed on its own. `unmanaged-exists`: something not in the ledger is at the target.
 * `user-modified`: the target changed since harness wrote it. `other-owner`: another owner holds different content,
 * or a retained foreign hook still serves another agent and cannot safely be replaced or reused.
 * `dotfiles-managed`: a ForeignOwner such as chezmoi manages the path and would undo the write.
 * `symlinked-target`: the path is a symlink, which an atomic write would replace with a regular file.
 */
export type Conflict = "unmanaged-exists" | "user-modified" | "other-owner" | "dotfiles-managed" | "symlinked-target";

/**
 * An explicit decision for one conflicting locator. `adopt`: what is there counts as the owner's own and is replaced,
 * so uninstall deletes it. `backup`: it is replaced and kept as the pre-image, so uninstall restores it. `force`:
 * the owner's content replaces another owner's or the user's.
 */
export type ConflictChoice = "force" | "adopt" | "backup";

/**
 * The choices that can resolve each conflict. Nothing ever writes at a dotfiles-managed path or through a symlink:
 * plan another strategy, change the dotfiles source, or plan the symlink's resolved path. `adopt` resolves a symlinked
 * target only where nothing has to be written, taking the link's current content as the owner's; `conflictChoices`
 * gives the choices for one conflicting step.
 */
export const CONFLICT_CHOICES: Readonly<Record<Conflict, readonly ConflictChoice[]>> = {
  "unmanaged-exists": ["adopt", "backup"],
  "user-modified": ["force"],
  "other-owner": ["force"],
  "dotfiles-managed": [],
  "symlinked-target": ["adopt"]
};
