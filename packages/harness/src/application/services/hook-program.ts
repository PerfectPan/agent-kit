import { parse, type ParseEntry } from "shell-quote";

/**
 * Marks a `$` lookup inside the word `shell-quote` was reading, including a bare `$`. A file path cannot contain
 * NUL, so the mark cannot be a real program path.
 */
const PARAMETER_LOOKUP = "\u0000";

function certainWord(word: string): boolean {
  // `shell-quote` has already applied the escapes it understands. A backtick, `{`, or `[` left in the word is shell
  // syntax it does not run, so that path is not checked.
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
 * in it, it contains no backtick, `{`, or `[`, and it starts with `/`. A program that needs shell expansion is not
 * checked: the path would depend on the shell.
 */
export function hookProgram(command: string): string | undefined {
  let entries: readonly ParseEntry[];
  try {
    entries = parse(command, () => {
      // Every lookup, including a bare `$`, is a parameter or substitution `shell-quote` does not run.
      return PARAMETER_LOOKUP;
    });
  } catch {
    // `shell-quote` rejects an empty or unfinished `${…}` substitution. That command has no certain program.
    return undefined;
  }
  const first = entries[0];
  // `first` is shell-quote's ParseEntry union; a string is a plain word, and the rest are operators, globs, and comments.
  if (typeof first !== "string" || !certainWord(first)) {
    return undefined;
  }
  return first;
}
