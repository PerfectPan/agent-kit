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
 * A JSON or C escape (`\n`, `\u0022`), URL encoding (`%22`, `%3D`) or ANSI SGR colour sequence (`\x1b[32m`, spelled
 * `\u001b[32m` inside a JSON string) ending right before a match start: its last character is a letter or digit and
 * would otherwise count as part of a word.
 */
const ESCAPE_END = String.raw`\\[nrtbf]|\\u[0-9A-Fa-f]{4}|%[0-9A-Fa-f]{2}|\x1b\[[0-9;]*m|\\u001[bB]\[[0-9;]*m`;

/**
 * Where a token may start: at the start, after a character that is not `word`, or right after such an escape.
 */
const tokenStart = (word: string) => String.raw`(?<=^|[^${word}]|${ESCAPE_END})`;

/**
 * A prefix that starts a token: the literal comes first so the engine can skip ahead to it, and a look-behind then
 * checks that the character before it is not in `word` (or is an escape).
 */
const prefixAtTokenStart = (word: string, prefix: string) =>
  String.raw`${prefix}(?<=(?:^|[^${word}]|${ESCAPE_END})${prefix})`;

/**
 * API keys and tokens by their published prefixes (OpenAI and Anthropic `sk-`, AWS key ids, GitHub, Slack, npm,
 * Stripe, GitLab, Hugging Face, Google), JWTs, Slack webhook URLs and PEM private key blocks; a block whose END line
 * is missing is hidden up to the end of its base64 text. A prefix inside a longer word (`task-…`) is not a key; the
 * newer prefixes also need a start that is not `_` or `-`, so a long base64url blob does not lose a slice from its middle.
 */
const SECRET = new RegExp(
  [
    String.raw`${prefixAtTokenStart("A-Za-z0-9", "(?:sk-|AKIA|ASIA|gh[pousr]_|github_pat_|xox[abprs]-)")}[A-Za-z0-9_-]{8,}`,
    String.raw`${prefixAtTokenStart("A-Za-z0-9", "npm_")}[A-Za-z0-9]{36}`,
    String.raw`${prefixAtTokenStart("A-Za-z0-9_-", "(?:sk|rk)_(?:live|test|prod)_")}[A-Za-z0-9]{10,}`,
    String.raw`${prefixAtTokenStart("A-Za-z0-9_-", "glpat-")}[A-Za-z0-9_-]{20,}`,
    String.raw`${prefixAtTokenStart("A-Za-z0-9_-", "hf_")}[A-Za-z0-9]{30,}`,
    String.raw`${prefixAtTokenStart("A-Za-z0-9_-", "AIza")}[A-Za-z0-9_-]{35}`,
    // Header and payload are base64url JSON objects, so both start with `eyJ` (`{"`); an unsigned token has no signature.
    String.raw`${prefixAtTokenStart("A-Za-z0-9_-", "eyJ")}[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*`,
    String.raw`https://hooks\.slack\.com/(?:services|workflows|triggers)/[A-Za-z0-9_/+-]{20,}`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----` +
      String.raw`(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|(?:[A-Za-z0-9+/=\r\n]|\\[nr])*)`
  ].join("|"),
  "g"
);

/**
 * A value that names a type, a flag or a placeholder instead of holding a credential (`password: string`,
 * `secret: false`, `token=${TOKEN}`, `"TOKEN": "env:TOKEN"`, `password=<your password>`, `****`), or a number
 * (`cost_per_token: 1.5e-5`). Such a value is kept.
 */
const NOT_A_CREDENTIAL =
  /^(?:true|false|null|none|undefined|string|number|boolean|str|int|bool|object|any|required|optional)$|^[$<{%*]|^env:|^[*x.]+$|^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * Whether an assigned value holds a credential rather than code, a label or a count. A value with a digit does:
 * `PASSWORD=hunter2`. Without one, an unquoted value is code (`token = getToken()`, `token: process.env.TOKEN!`), and a quoted one needs
 * 20 or more characters without a space or a dot, so the labels of a dictionary (`"password": "Password"`) stay and
 * `"correcthorsebatterystaple"` does not.
 */
function isCredential(value: string, quoted: boolean): boolean {
  if (NOT_A_CREDENTIAL.test(value)) {
    return false;
  }
  return /\d/.test(value) || (quoted && value.length >= 20 && !/[\s.]/.test(value));
}

/**
 * `key: value` and `key=value` whose key ends in a credential name (`password`, `DB_PASSWORD`, `client_secret`,
 * `GITHUB_TOKEN`, `X-Api-Key`, `SECRET_KEY`, `aws_secret_access_key`, `secretAccessKey`), raw, quoted or JSON-escaped,
 * also with a type annotation between them before a quoted value (`password: str = "…"`). Only the value is replaced. The match starts at
 * the credential name, which the separator after it makes the end of the key; what precedes it in the key does not
 * matter. `max_tokens` and `input_tokens` end in `tokens`, not `token`, so usage counts stay.
 *
 * A quoted value may hold the other quote and escapes but never an unescaped `"`, so a JSON-escaped value inside a
 * JSON string cannot run past that string. It also ends at a line end, an unescaped `"` or the end of the text, so a
 * preview cut before its closing quote is still hidden. An unquoted value is taken whole, with the bracket that may
 * follow it: one followed by `(`, `{` or `[` is a call or a literal (`gen2()`, `corev1.Secret{}`), not a credential.
 * Deciding that in the callback keeps every match attempt linear.
 */
const CREDENTIAL_ASSIGNMENT = new RegExp(
  String.raw`(pass(?:word|wd|phrase)|secret|token|(?:api|private|access|secret)[_-]?key)` +
    String.raw`(\\?["']?\s*(?::\s*[A-Za-z_][\w.]*(?:<[^<>\r\n]*>)?\??\s*(?==\s*\\?["']))?[:=]\s*)` +
    String.raw`(?:(\\?["'])((?:(?!\3)(?:[^"\\\r\n]|\\.)){4,})(\3|(?=[\r\n"])|$)` +
    String.raw`|(?=([A-Za-z0-9!#$%*+./:=?@^_|~-]{4,}[({[]?))\6)`,
  "gi"
);

/*
 * The credentials below follow a label, with the label and the value as the two groups. Each pattern starts from a
 * literal and checks what precedes it with a look-behind after that literal: a leading look-behind of variable length
 * would rescan a long token at every offset. A label also starts right after an escape (`\r\nAuthorization:` in raw
 * JSONL), where `\b` sees no word boundary.
 */

/**
 * The credential after `Authorization: Bearer|Basic|Token`, raw, quoted or JSON-escaped: 8 or more token characters
 * (RFC 6750 `b64token`), so a placeholder such as `<token>`, `${TOKEN}` or `…` stays.
 */
const AUTHORIZATION_HEADER = new RegExp(
  String.raw`(${prefixAtTokenStart("A-Za-z0-9_", "authorization")}\\?["']?\s*[:=]\s*\\?["']?(?:bearer|basic|token)\s+)` +
    String.raw`([A-Za-z0-9._~+/-]{8,}=*)`,
  "gi"
);

/** A standalone `Bearer` value of 16 or more token characters that holds a digit, so "Bearer of bad news" stays. */
const BEARER_VALUE = new RegExp(
  String.raw`(${prefixAtTokenStart("A-Za-z0-9_", "bearer")}\s+)((?=[A-Za-z0-9._~+/-]*\d)[A-Za-z0-9._~+/-]{16,}=*)`,
  "gi"
);

/**
 * The password of URL userinfo (`postgres://user:secret@host`); the scheme and the user name stay. The scheme is
 * checked by a short look-behind once `://` matched, and the caller skips text without `://`.
 */
const URL_PASSWORD = /(?<=\b[A-Za-z][A-Za-z0-9+.-]*)(:\/\/[^\s/:@"'<>]+:)([^\s/@"'<>]+)(?=@)/g;

function hideAfterLabel(match: string, label: string, value: string): string {
  return NOT_A_CREDENTIAL.test(value) ? match : `${label}${REDACTED}`;
}

function hideAssignment(
  match: string,
  name: string,
  separator: string,
  quote: string | undefined,
  quoted: string | undefined,
  closing: string | undefined,
  bare: string | undefined
): string {
  if (quote !== undefined && quoted !== undefined) {
    return isCredential(quoted, true) ? `${name}${separator}${quote}${REDACTED}${closing ?? ""}` : match;
  }
  if (bare === undefined || /[({[]$/.test(bare) || !isCredential(bare, false)) {
    return match;
  }
  return `${name}${separator}${REDACTED}`;
}

/** Credentials that a label names: assignments, authorization headers and URL userinfo. */
function hideLabelledCredentials(text: string): string {
  const labelled = text
    .replace(CREDENTIAL_ASSIGNMENT, hideAssignment)
    .replace(AUTHORIZATION_HEADER, hideAfterLabel)
    .replace(BEARER_VALUE, hideAfterLabel);
  // Most text holds no URL; skipping that scan keeps long tool output fast.
  return labelled.includes("://") ? labelled.replace(URL_PASSWORD, hideAfterLabel) : labelled;
}

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
   * a letter, digit, `_` or `%` — including `*` in a glob and `]` in markdown — and after an escape that ends in a
   * name character (`\n-Users-alice` in raw JSONL, `%2F-Users-alice` from component encoding, such as a query
   * value). A one-segment home (`/root` becomes
   * `-root`) hides its slug only at a path segment start: after other punctuation the text is an ordinary word or
   * flag (`npm --root-dir x`, `*-root-p`, `x.-root`, `a--root`) that this boundary keeps and the wide boundary would
   * rewrite (`npm -~-dir x`); the word in `pre-root` stays under either.
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
 * a file URL, and without its leading slash (`u/me/x`, a path relative to `/`) when no name character precedes it —
 * an escape that ends in one (`\nu/me/x`) counts as none. A home of one segment (`/root`) has no slash-less form:
 * alone it is an ordinary word.
 */
function posixSpellings(root: string): string[] {
  const spellings = [escapeRegExp(root), escapeRegExp(root.replaceAll("/", "\\/")), escapeRegExp(encodeURI(root))];
  if (/^\/[^/]+\/./.test(root)) {
    spellings.push(`(?:(?<![${NAME}])|(?<=${ESCAPE_END}))${escapeRegExp(root.slice(1))}`);
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
  const segments = root.split(/[\\/]+/);
  const user = segments.at(-1) ?? "";
  if (user === "" || /^[A-Za-z]:$/.test(user)) {
    return { home, encoded: undefined, literal: undefined, tilde: undefined };
  }
  const drive = /^([A-Za-z]):$/.exec(segments[0] ?? "")?.[1];
  const literal =
    drive === undefined ? posixSpellings(root) : windowsSpellings(drive, segments.slice(1).join("/"), root);
  const pathSegments = drive === undefined ? segments.filter(Boolean) : segments.slice(1);
  // A hidden spelling starts after a character that is not a name character (or `%`, whose sequence continues into
  // the spelling), or right after an escape, whose last character would otherwise count as one.
  const escapedStart = `(?:(?<![${NAME}%])|(?<=${ESCAPE_END}))`;
  const slugStart = pathSegments.length > 1 ? escapedStart : SEGMENT_START;
  const dash = root.replace(/[^A-Za-z0-9]/g, "-");
  return {
    home,
    encoded: new RegExp(
      `(?:${escapedStart}${escapeRegExp(encodeURIComponent(root))}|${slugStart}${escapeRegExp(dash)})(?![${NAME}])`,
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
 * Tested at a match's offset: a separator and a path segment end there, so the home continues a longer path. An escape
 * or colour sequence ending there is no segment (`\n/u/me`), nor is a token that no separator opens (`-I/u/me`, the
 * diff header `a/u/me`).
 */
const CONTINUES_PATH = new RegExp(String.raw`(?<=[\\/][^\\/\s"'\x60(=:,;]+)(?<!${ESCAPE_END})`, "uy");
/** The leading separator of a literal spelling, raw or JSON-escaped. */
const LEADING_SEPARATOR = /^(?:\\[\\/]|[\\/])/;

/**
 * The replacement for one literal home spelling. The home is hidden wherever it appears, because a longer path can
 * name the same directory (on macOS `/private/tmp` is `/tmp`, and a home under `/System/Volumes/Data` is the home). When it
 * continues a longer path, the spelling keeps its own leading separator so the path still reads as one:
 * `/private/tmp/x/a` with home `/tmp/x` reads `/private/~/a`.
 */
function hideLiteralHome(match: string, offset: number, whole: string): string {
  CONTINUES_PATH.lastIndex = offset;
  const separator = CONTINUES_PATH.test(whole) ? LEADING_SEPARATOR.exec(match)?.[0] : undefined;
  return separator === undefined ? "~" : `${separator}~`;
}

/**
 * Replaces every spelling of `options.home` with `~` and every secret-shaped string with `[redacted]`. Matching
 * ignores case, so a mixed-case spelling on a case-insensitive file system is hidden too, at the cost of also hiding
 * a different directory that differs only in case.
 */
export function redactText(text: string, options: RedactOptions): string {
  const patterns = homePatterns(options.home);
  let result = text;
  if (patterns.encoded !== undefined) {
    result = result.replace(patterns.encoded, "~");
  }
  if (patterns.literal !== undefined) {
    result = result.replace(patterns.literal, hideLiteralHome);
  }
  if (patterns.tilde !== undefined) {
    result = result.replace(patterns.tilde, "~");
  }
  return hideLabelledCredentials(result).replace(SECRET, REDACTED);
}

/** The copy of one value with every string it holds redacted, walking arrays and plain objects; other values pass as they are. */
function redactValue(value: unknown, options: RedactOptions): unknown {
  // A deep walker over values of an unknown shape, like the deep-freeze helpers: the string, array and plain-object
  // decisions are the walk itself, not a shape guard on one record.
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
