import * as z from "zod/mini";

/**
 * The providers, by LiteLLM's `litellm_provider`, whose own APIs the supported agents call: Claude Code, Codex,
 * Gemini CLI, Grok, opencode and Pi record these providers' model names. Every other provider in the list either routes
 * to the same models through a cloud or gateway (`bedrock/…`, `vertex_ai/…`, `azure/…`, `openrouter/…`), where its
 * key would only duplicate a first-party entry, or serves models no supported agent records by default; adding one is
 * a reviewed edit of this list. `vertex_ai-language-models` is Google's own provider for unprefixed Gemini keys, such
 * as `gemini-3-flash-preview`, that the `gemini` provider has only under its `gemini/` prefix.
 */
const PROVIDERS = new Set([
  "anthropic",
  "openai",
  "gemini",
  "vertex_ai-language-models",
  "xai",
  "deepseek",
  "zai",
  "moonshot",
  "minimax"
]);

/** The modes of models that agents converse with; image, audio, embedding and realtime models stay out. */
const MODES = new Set(["chat", "responses"]);

/** A price field that is not a finite number reads as absent, as it does in `fromLiteLLM`. */
const OptionalCost = z.catch(z.optional(z.number()), undefined);

const Entry = z.object({
  litellm_provider: z.string(),
  mode: z.string(),
  input_cost_per_token: z.number(),
  output_cost_per_token: z.number(),
  cache_creation_input_token_cost: OptionalCost,
  cache_creation_input_token_cost_above_1hr: OptionalCost,
  cache_read_input_token_cost: OptionalCost
});

const List = z.record(z.string(), z.unknown());

const Commit = z.object({
  sha: z.string().check(z.regex(/^[0-9a-f]{40}$/)),
  commit: z.object({ committer: z.object({ date: z.iso.datetime() }) })
});

/** The response of GitHub's commit listing, of which only the first (latest) commit is read. */
const Commits = z.tuple([Commit], z.unknown());

const Current = z.object({ version: z.string() });

/** The fields of one entry that `fromLiteLLM` reads, in USD per token under LiteLLM's names, in this order. */
export interface SnapshotEntry {
  input_cost_per_token: number;
  output_cost_per_token: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  cache_read_input_token_cost?: number;
}

export interface Snapshot {
  /** `<date>+<commit>`: the UTC date and commit of the LiteLLM file the prices come from. */
  version: string;
  prices: Record<string, SnapshotEntry>;
}

/**
 * Rounded to 1e-12 USD per token, the precision `fromLiteLLM` keeps (1e-6 USD per million tokens), so floating-point
 * noise in LiteLLM's numbers changes neither the file nor the prices read from it.
 */
function rounded(value: number): number {
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000_000_000;
}

function entryOf(entry: z.output<typeof Entry>): SnapshotEntry {
  const optional = (value: number | undefined) => (value === undefined ? undefined : rounded(value));
  const cacheWrite = optional(entry.cache_creation_input_token_cost);
  const cacheWrite1h = optional(entry.cache_creation_input_token_cost_above_1hr);
  const cacheRead = optional(entry.cache_read_input_token_cost);
  return {
    input_cost_per_token: rounded(entry.input_cost_per_token),
    output_cost_per_token: rounded(entry.output_cost_per_token),
    ...(cacheWrite === undefined ? {} : { cache_creation_input_token_cost: cacheWrite }),
    ...(cacheWrite1h === undefined ? {} : { cache_creation_input_token_cost_above_1hr: cacheWrite1h }),
    ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead })
  };
}

/**
 * The entries of LiteLLM's `model_prices_and_context_window.json` that the snapshot keeps, by model name: the chat and
 * responses models of `PROVIDERS` that have an input and an output price.
 *
 * Names follow three rules:
 * - An entry's own `<litellm_provider>/` prefix is dropped (`xai/grok-4.20` becomes `grok-4.20`). LiteLLM keys most
 *   Gemini, xAI, Z.ai, Moonshot and MiniMax models only that way, but agents record the bare model name, and
 *   `createPricing` matches a key that the id contains, so a prefixed key would never price a recorded id.
 * - A key that still has a `/` after that is a route through another provider (`vertex_ai/…`, `openrouter/…`) or a
 *   variant such as an image size, and is left out.
 * - When a bare key and a prefixed one name the same model, the bare key wins: it is LiteLLM's entry for the name
 *   without a provider, the price LiteLLM itself charges for it. Two prefixed keys fall back to code-unit order.
 *
 * Names are sorted by code unit, so the result depends only on the list's content, not its key order.
 */
export function selectPrices(list: unknown): Record<string, SnapshotEntry> {
  const chosen = new Map<string, { key: string; entry: SnapshotEntry }>();
  for (const [key, value] of Object.entries(z.parse(List, list))) {
    const parsed = Entry.safeParse(value);
    if (!parsed.success || !PROVIDERS.has(parsed.data.litellm_provider) || !MODES.has(parsed.data.mode)) {
      continue;
    }
    const prefix = `${parsed.data.litellm_provider}/`;
    const name = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    if (name.includes("/")) {
      continue;
    }
    const held = chosen.get(name);
    if (held === undefined || (held.key !== name && (key === name || key < held.key))) {
      chosen.set(name, { key, entry: entryOf(parsed.data) });
    }
  }
  if (chosen.size === 0) {
    throw new Error("no LiteLLM entry priced a model of the selected providers; has the list's format changed?");
  }
  return Object.fromEntries(
    [...chosen].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, { entry }]) => [name, entry] as const)
  );
}

/** The version of a snapshot generated from the latest commit in GitHub's commit listing of the LiteLLM file. */
export function versionOf(commits: unknown): { commit: string; version: string } {
  const [{ sha, commit }] = z.parse(Commits, commits);
  // An ISO datetime without an offset is in UTC, which GitHub always uses.
  return { commit: sha, version: `${commit.committer.date.slice(0, 10)}+${sha}` };
}

export function formatSnapshot(snapshot: Snapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * The snapshot file's next text, or `undefined` when `current` already holds these prices: a new LiteLLM commit that
 * changes no price kept here is not an update, so the version keeps naming the commit the prices were taken from.
 */
export function nextSnapshot(
  current: string | undefined,
  prices: Record<string, SnapshotEntry>,
  version: string
): string | undefined {
  if (current !== undefined) {
    const held = Current.safeParse(JSON.parse(current));
    if (held.success && formatSnapshot({ version: held.data.version, prices }) === current) {
      return undefined;
    }
  }
  return formatSnapshot({ version, prices });
}
