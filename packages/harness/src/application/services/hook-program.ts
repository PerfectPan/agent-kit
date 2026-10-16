import { parse, type ParseEntry } from "shell-quote";

/**
 * Marks a `$` lookup inside the word `shell-quote` was reading, including a bare `$`. A file path cannot contain
 * NUL, so the mark cannot be a real program path.
 */
const PARAMETER_LOOKUP = "\u0000";

function certainWord(word: string): boolean {
  return (
    word.startsWith("/") &&
    !word.includes(PARAMETER_LOOKUP) &&
    !word.includes("`") &&
    !word.includes("{") &&
    !word.includes("[")
  );
}

/**
 * The absolute program a hook command runs, when that program is certain. `shell-quote` reads the first word,
 * applying quotes and backslash escapes. The word is checked only when it is a plain string, no `$` was expanded
 * in it, it contains no backtick, `{`, or `[`, it starts with `/`, and the next entry is not a comment.
 * `shell-quote` starts a comment at an unquoted `#`, including one in the middle of a word. A program that needs
 * shell expansion is not checked: the path would depend on the shell.
 */
export function hookProgram(command: string): string | undefined {
  let entries: readonly ParseEntry[];
  try {
    entries = parse(command, () => PARAMETER_LOOKUP);
  } catch {
    // `shell-quote` rejects an empty or unfinished `${…}` substitution. That command has no certain program.
    return undefined;
  }
  const first = entries[0];
  const next = entries[1];
  // `first` and `next` are shell-quote's ParseEntry union; a string is a plain word, and a comment is the object with `comment`.
  if (
    typeof first !== "string" ||
    !certainWord(first) ||
    (next !== undefined && typeof next !== "string" && "comment" in next)
  ) {
    return undefined;
  }
  return first;
}
