import { isPlainObject } from "es-toolkit";

export interface RedactOptions {
  /**
   * The home directory to hide, as the host spells it: `/u/me` or `C:\Profiles\me`. Every spelling of it becomes
   * `~`. An empty string or a file system root hides no path.
   */
  readonly home: string;
}

const REDACTED = "[redacted]";

/**
 * Where a token may start: at the start, after a character that is not `word`, or right after an escape that ends in
 * a letter or digit: a JSON or C escape (`\n`, `\u0022`) or URL encoding (`%22`, `%3D`). The escape's last character
 * would otherwise count as part of a word.
 */
const tokenStart = (word: string) => String.raw`(?<=^|[^${word}]|\\[nrtbf]|\\u[0-9A-Fa-f]{4}|%[0-9A-Fa-f]{2})`;

/**
 * API keys and tokens by their published prefixes (OpenAI and Anthropic `sk-`, AWS key ids, GitHub, Slack, npm) and
 * PEM private key blocks; a block whose END line is missing is hidden up to the end of its base64 text. A prefix
 * inside a longer word (`task-…`) is not a key.
 */
const SECRET = new RegExp(
  [
    String.raw`${tokenStart("A-Za-z0-9")}(?:sk-|AKIA|ASIA|gh[pousr]_|github_pat_|xox[abprs]-)[A-Za-z0-9_-]{8,}`,
    String.raw`${tokenStart("A-Za-z0-9")}npm_[A-Za-z0-9]{36}`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----` +
      String.raw`(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|(?:[A-Za-z0-9+/=\r\n]|\\[nr])*)`
  ].join("|"),
  "g"
);

/** Letters, digits and `_` continue a path segment; `u` makes non-ASCII letters count. */
const NAME = String.raw`\p{L}\p{N}_`;
/** A path segment starts here: at the start, after a separator, whitespace, a quote or punctuation that opens a value. */
const SEGMENT_START = String.raw`(?<=^|[\\/\s"'\x60(=:,;])`;
/** After the home: a name character or `-` continues the segment (`<home>x`), as does `.` plus one (`<home>.bak`). */
const SEGMENT_END = String.raw`(?![${NAME}-]|\.[${NAME}])`;

interface HomePatterns {
  readonly home: string;
  /**
   * Percent-encoding and Claude Code's project slug, as agents spell a directory in their own folder names. The slug
   * of a home with more than one segment (`-Users-alice`, `C--Profiles-me`) is hidden after any character that is not
   * a letter, digit, `_` or `%` — including `*` in a glob and `]` in markdown. A one-segment home (`/root` becomes
   * `-root`) hides its slug only at a path segment start, so the word in `pre-root` stays.
   */
  readonly encoded: RegExp | undefined;
  /** The literal spellings: native, other separator, JSON-escaped, URL-encoded, without the leading slash. */
  readonly literal: RegExp | undefined;
  /** `~<user>`, the shell's name for the same directory. */
  readonly tilde: RegExp | undefined;
}

let cached: HomePatterns | undefined;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * `/u/me` anywhere (inside `a/u/me` of a diff header or `file:///u/me`), JSON-escaped as `\/u\/me`, URL-encoded as in
 * a file URL, and without its leading slash (`u/me/x`, a path relative to `/`) when no name character precedes it.
 * A home of one segment (`/root`) has no slash-less form: alone it is an ordinary word.
 */
function posixSpellings(root: string): string[] {
  const spellings = [escapeRegExp(root), escapeRegExp(root.replaceAll("/", "\\/")), escapeRegExp(encodeURI(root))];
  if (/^\/[^/]+\/./.test(root)) {
    spellings.push(`(?<![${NAME}])${escapeRegExp(root.slice(1))}`);
  }
  return unique(spellings);
}

/**
 * `C:\Profiles\me` with either separator, JSON-escaped as `C:\\Profiles\\me`, URL-encoded as in
 * `file:///C:/Profiles/me`, and as MSYS and Git Bash spell it (`/c/Profiles/me`).
 */
function windowsSpellings(drive: string, rest: string, root: string): string[] {
  const forward = `${drive}:/${rest}`;
  return unique([
    escapeRegExp(root),
    escapeRegExp(forward),
    escapeRegExp(forward.replaceAll("/", "\\")),
    escapeRegExp(forward.replaceAll("/", "\\\\")),
    escapeRegExp(encodeURI(forward)),
    escapeRegExp(`/${drive}/${rest}`)
  ]);
}

function buildPatterns(home: string): HomePatterns {
  const root = home.replace(/(?<=.)[\\/]+$/, "");
  const segments = root.split(/[\\/]/);
  const user = segments.at(-1) ?? "";
  if (user === "" || /^[A-Za-z]:$/.test(user)) {
    return { home, encoded: undefined, literal: undefined, tilde: undefined };
  }
  const drive = /^([A-Za-z]):$/.exec(segments[0] ?? "")?.[1];
  const literal =
    drive === undefined ? posixSpellings(root) : windowsSpellings(drive, segments.slice(1).join("/"), root);
  const oneSegment = drive === undefined ? segments.filter(Boolean).length < 2 : segments.length < 3;
  const slugStart = oneSegment ? SEGMENT_START : `(?<![${NAME}%])`;
  const dash = root.replace(/[^A-Za-z0-9]/g, "-");
  return {
    home,
    encoded: new RegExp(
      `(?:(?<![${NAME}%])${escapeRegExp(encodeURIComponent(root))}|${slugStart}${escapeRegExp(dash)})(?![${NAME}])`,
      "giu"
    ),
    literal: new RegExp(`(?:${literal.join("|")})${SEGMENT_END}`, "giu"),
    tilde: new RegExp(`${tokenStart(NAME)}~${escapeRegExp(user)}${SEGMENT_END}`, "giu")
  };
}

function homePatterns(home: string): HomePatterns {
  if (cached?.home !== home) {
    cached = buildPatterns(home);
  }
  return cached;
}

/**
 * Replaces every spelling of `options.home` with `~` and every secret-shaped string with `[redacted]`. Matching
 * ignores case, so a mixed-case spelling on a case-insensitive file system is hidden too, at the cost of also hiding
 * a different directory that differs only in case.
 */
export function redactText(text: string, options: RedactOptions): string {
  const patterns = homePatterns(options.home);
  let result = text;
  for (const pattern of [patterns.encoded, patterns.literal, patterns.tilde]) {
    if (pattern !== undefined) {
      result = result.replace(pattern, "~");
    }
  }
  return result.replace(SECRET, REDACTED);
}

function redactValue(value: unknown, options: RedactOptions): unknown {
  if (typeof value === "string") {
    return redactText(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, options));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [redactText(key, options), redactValue(item, options)])
    );
  }
  return value;
}

/**
 * Returns a copy of a JSON-like value with `redactText` applied to every string, including object keys. Arrays and
 * plain objects are copied; other objects (dates, class instances) are returned as they are, and nothing is mutated.
 */
export function redact<T>(value: T, options: RedactOptions): T {
  return redactValue(value, options) as T;
}
