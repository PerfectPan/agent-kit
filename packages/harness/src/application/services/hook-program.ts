import { parse, type ParseEntry } from "shell-quote";

/**
 * Marks a named-parameter lookup inside the word `shell-quote` was reading. A file path cannot contain NUL, so the
 * mark cannot be a real program path.
 */
const PARAMETER_LOOKUP = "\u0000";

function certainWord(word: string): boolean {
  // `shell-quote` has already applied the escapes it understands, so a backtick here is a literal character. It does
  // not run command substitution, and a hook path that contains a backtick is not worth a stale-path check.
  return word.startsWith("/") && !word.includes(PARAMETER_LOOKUP) && !word.includes("`");
}

function opensSubstitution(entry: ParseEntry | undefined): boolean {
  // `entry` is shell-quote's ParseEntry union; a string is a plain word.
  return typeof entry !== "string" && entry !== undefined && "op" in entry && entry.op === "(";
}

/**
 * The absolute program a hook command runs, when that program is certain. `shell-quote` reads the first word,
 * applying quotes and backslash escapes. The word is checked only when it is a plain string, no named parameter was
 * expanded in it, it does not end in `$` followed by a `(` operator, it contains no backtick, and it starts with
 * `/`. A program that needs shell expansion is not checked: the path would depend on the shell.
 */
export function hookProgram(command: string): string | undefined {
  let entries: readonly ParseEntry[];
  try {
    entries = parse(command, (key) => {
      // An empty name is a bare `$`. Returning no value makes shell-quote keep it, so `$(` stays `$` and a `(` operator.
      return key === "" ? undefined : PARAMETER_LOOKUP;
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
  if (first.endsWith("$") && opensSubstitution(entries[1])) {
    return undefined;
  }
  return first;
}
