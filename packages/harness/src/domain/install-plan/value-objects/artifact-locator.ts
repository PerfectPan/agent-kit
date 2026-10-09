/** What kind of thing an Artifact is at its path. */
export type ArtifactKind =
  | "file"
  | "dir"
  | "symlink"
  | "json-entry"
  | "toml-entry"
  | "managed-block"
  | "cli-registration";

/**
 * Where one Artifact lives.
 *
 * Path convention, the same for `InstallTarget.roots`: absolute and normalized, with every directory above the
 * Artifact resolved by realpath and the Artifact's own last segment not followed (`realpath(dirname) + "/" +
 * basename`). Two spellings of one file are then one locator, and a symlink at the Artifact itself stays visible: the
 * application reports it as `ObservedArtifact.symlinkTarget`, and a step that would write or delete through it is a
 * `symlinked-target` conflict, because an atomic write replaces the link with a regular file.
 */
export interface ArtifactLocator {
  readonly kind: ArtifactKind;
  /** See the path convention above. For a cli-registration, the file in which the agent's command line records it. */
  readonly path: string;
  /**
   * Required for the kinds inside a file and absent for the others: a JSON pointer (`/hooks/Stop`) for json-entry and
   * toml-entry (over the TOML document's data), the block id for managed-block, the registered name for
   * cli-registration. A JSON pointer never names an array index, because indexes move when the user edits the array;
   * a segment of digits or `-` reads as one, so object keys the kit writes never look like that (see `checkBundle`).
   */
  readonly pointer?: string;
  /**
   * For a json-entry or toml-entry that is an element of the array at `pointer`: the element's identity, such as a
   * hook's command, which the configuration editor matches to find the element's index right before it writes. Other
   * elements inserted or removed around it then never redirect a step to the user's element.
   */
  readonly member?: string;
  /**
   * Where `member` sits. `element` (the default): an element of the array at `pointer`. `hook-group`: one hook inside
   * the groups of an event's hook list, as Claude Code's settings file nests them (`/hooks/<event>/<group>/hooks/<i>`):
   * the editor matches the hook whose command is `member` in any group, adds a new hook as a group of its own, and
   * drops a group that a removal leaves empty. A HookSpec sets no matcher, so the command alone identifies a bundle's
   * hook in an event; once a bundle can set matchers, the group's matcher belongs in `member` too. Not part of the key.
   */
  readonly memberIn?: "element" | "hook-group";
}

/**
 * The identity of a locator: its path, pointer and member. The kind is not part of it, because one path holds one
 * thing at a time; a file replaced by a directory is the same Artifact with different content.
 */
export type LocatorKey = string;

const ENTRY_KINDS: ReadonlySet<ArtifactKind> = new Set([
  "json-entry",
  "toml-entry",
  "managed-block",
  "cli-registration"
]);

const ARRAY_INDEX = /^(?:\d+|-)$/;

export function locatorKey(locator: ArtifactLocator): LocatorKey {
  const { path, pointer, member } = locator;
  return JSON.stringify(
    pointer === undefined ? [path] : member === undefined ? [path, pointer] : [path, pointer, member]
  );
}

/** The pointer text, or `""` when the locator kind has none. */
export function locatorPointer(locator: Pick<ArtifactLocator, "pointer">): string {
  return locator.pointer === undefined ? "" : locator.pointer;
}

/**
 * The last segment of a JSON pointer, with `~1` and `~0` undone. A missing pointer has none; an empty pointer's
 * only segment is empty.
 */
export function pointerTail(pointer: string | undefined): string | undefined {
  if (pointer === undefined) {
    return undefined;
  }
  const parts = pointer.split("/");
  const segment = parts[parts.length - 1] ?? "";
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * The segments of an absolute, normalized path (POSIX `/a/b` or Windows `C:\a\b`), or `undefined` for any other
 * path. Both separators split, so a backslash in a POSIX file name makes the check stricter, never looser.
 */
function segments(path: string): readonly string[] | undefined {
  const [head, ...rest] = path.split(/[\\/]/);
  if (head === undefined || (head !== "" && !/^[A-Za-z]:$/.test(head)) || rest.length === 0) {
    return undefined;
  }
  return rest.some((segment) => segment === "" || segment === "." || segment === "..") ? undefined : [head, ...rest];
}

/** Why a locator cannot be used, or `undefined` when it can. */
export function locatorProblem(locator: ArtifactLocator): string | undefined {
  if (segments(locator.path) === undefined) {
    return "path is not absolute and normalized";
  }
  if (ENTRY_KINDS.has(locator.kind) !== (locator.pointer !== undefined)) {
    return ENTRY_KINDS.has(locator.kind) ? `${locator.kind} needs a pointer` : `${locator.kind} takes no pointer`;
  }
  const structured = locator.kind === "json-entry" || locator.kind === "toml-entry";
  const pointer = locator.pointer;
  if (structured && (pointer === undefined || !pointer.startsWith("/"))) {
    return "pointer is not a JSON pointer to an entry";
  }
  if (structured && pointer !== undefined && pointer.split("/").some((segment) => ARRAY_INDEX.test(segment))) {
    return "pointer names an array index; address the element by `member`";
  }
  if (locator.member !== undefined && (!structured || locator.member === "")) {
    return structured ? "member is empty" : `${locator.kind} takes no member`;
  }
  if (locator.memberIn !== undefined && locator.member === undefined) {
    return "memberIn without a member";
  }
  return locator.pointer === "" ? "pointer is empty" : undefined;
}

/** Whether `path` is `root` or inside it. Both must be absolute and normalized. */
export function isWithin(path: string, root: string): boolean {
  const inner = segments(path);
  const outer = segments(root);
  return (
    inner !== undefined &&
    outer !== undefined &&
    inner.length >= outer.length &&
    outer.every((segment, index) => inner[index] === segment)
  );
}

function pointerContains(outer: string, inner: string): boolean {
  return inner === outer || inner.startsWith(`${outer}/`);
}

/**
 * Whether two locators address the same thing or one contains the other: the same path where either is the whole
 * file or one pointer contains the other (elements of one array overlap only the whole array or themselves), or a
 * path inside another path.
 */
export function locatorsOverlap(a: ArtifactLocator, b: ArtifactLocator): boolean {
  if (a.path === b.path) {
    if (a.pointer === undefined || b.pointer === undefined) {
      return true;
    }
    if (a.pointer === b.pointer) {
      return a.member === undefined || b.member === undefined || a.member === b.member;
    }
    return pointerContains(a.pointer, b.pointer) || pointerContains(b.pointer, a.pointer);
  }
  return isWithin(a.path, b.path) || isWithin(b.path, a.path);
}
