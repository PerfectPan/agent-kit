import { parse, type ParseEntry } from "shell-quote";

/**
 * Marks a named-parameter lookup inside the word `shell-quote` was reading. A file path cannot contain NUL, so the
 * mark cannot be a real program path.
 */
const PARAMETER_LOOKUP = "\u0000";

/**
 * `shell-quote` does not run command substitution in backticks; it leaves an unescaped backtick in the word. A
 * backslash before one is an escape it already applied, so that backtick is part of the literal path.
 */
function hasRawBacktick(word: string): boolean {
  let escaped = false;
  for (const character of word) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") {
      return true;
    }
  }
  return false;
}

function certainWord(word: string): boolean {
  return word.startsWith("/") && !word.includes(PARAMETER_LOOKUP) && !hasRawBacktick(word);
}

function opensSubstitution(entry: ParseEntry | undefined): boolean {
  // `entry` is shell-quote's ParseEntry union; a string is a plain word.
  return typeof entry !== "string" && entry !== undefined && "op" in entry && entry.op === "(";
}

/**
 * The absolute program a hook command runs, when that program is certain. `shell-quote` reads the first word,
 * applying quotes and backslash escapes. The word is checked only when it is a plain string, no named parameter was
 * expanded in it, it does not end in `$` followed by a `(` operator, it holds no unescaped backtick, and it starts
 * with `/`. A program that needs shell expansion is not checked: the path would depend on the shell.
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
