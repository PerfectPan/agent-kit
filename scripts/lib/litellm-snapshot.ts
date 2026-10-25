import { createHash } from "node:crypto";

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

const Entry = z.looseObject({
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

/**
 * One `*_above_<N>k_tokens` tier of LiteLLM's list that the snapshot keeps, in USD per token under LiteLLM's field
 * names with the threshold factored out. A field is here only when LiteLLM lists it under the tier; the batch, flex,
 * priority, ultrafast and decisions variants of a price, and the tiers of another cache lifetime (`_above_12hr_…`),
 * are not kept.
 */
export interface SnapshotLongContext {
  /** The threshold, from the `<N>k` of the field names: 272000 for `_above_272k_tokens`. */
  above_tokens: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
}

/** The fields of one entry that `fromLiteLLM` reads, in USD per token under LiteLLM's names, in this order. */
export interface SnapshotEntry {
  input_cost_per_token: number;
  output_cost_per_token: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  cache_read_input_token_cost?: number;
  long_context?: SnapshotLongContext;
}

export interface Snapshot {
  /** `<date>+<commit>+<digest>`: the UTC date and commit of the LiteLLM file the prices come from, plus `priceDigest` of them. */
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

/**
 * The four rates a long-context tier can reprice, above `<N>k` (or bare) counts of tokens; the first group is the
 * field's name under the tier. A service tier's variant (`…_tokens_flex`, `…_tokens_priority`, `_batches`, and the
 * like) does not end in `_tokens` and is not a tier field, and neither is the tier of another cache lifetime
 * (`cache_creation_input_token_cost_above_12hr_above_…_tokens`).
 */
const TIERED =
  /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)_above_([0-9]+k?)_tokens$/;

/** The tier's one-hour cache writes, the one field whose name carries its lifetime before the threshold. */
const TIERED_1H = /^cache_creation_input_token_cost_above_1hr_above_([0-9]+k?)_tokens$/;

/** `<N>k` of a field name as a count of tokens: `272k` is 272000, a bare `100000` counts as it is. */
function thresholdTokens(suffix: string): number {
  return suffix.endsWith("k") ? Number(suffix.slice(0, -1)) * 1000 : Number(suffix);
}

/** The fields a tier can keep, in the order a tier writes them in, whatever order LiteLLM lists them in. */
const TIER_FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_read_input_token_cost",
  "cache_creation_input_token_cost",
  "cache_creation_input_token_cost_above_1hr"
] as const;

/**
 * The long-context tier of one parsed entry, its threshold parsed from the `*_above_<N>k_tokens` field names, its
 * rates rounded as the rest of the entry is. A tier keeps the fields LiteLLM lists under it, written in the
 * `TIER_FIELDS` order; when an entry listed more than one threshold, the largest would win — no entry lists two.
 */
function tierOf(entry: z.output<typeof Entry>): SnapshotLongContext | undefined {
  const tiers = new Map<number, Record<string, number>>();
  let largest: number | undefined;
  for (const [key, value] of Object.entries(entry)) {
    const rate = OptionalCost.parse(value);
    if (rate === undefined) {
      continue;
    }
    const flat = TIERED.exec(key);
    const over1h = flat === null ? TIERED_1H.exec(key) : null;
    if (flat === null && over1h === null) {
      continue;
    }
    const threshold = thresholdTokens(flat === null ? over1h![1]! : flat[2]!);
    const rates = tiers.get(threshold) ?? {};
    rates[flat === null ? "cache_creation_input_token_cost_above_1hr" : flat[1]!] = rate;
    tiers.set(threshold, rates);
    if (largest === undefined || threshold > largest) {
      largest = threshold;
    }
  }
  if (largest === undefined) {
    return undefined;
  }
  const rates = tiers.get(largest)!;
  return {
    above_tokens: largest,
    ...Object.fromEntries(
      TIER_FIELDS.filter((field) => rates[field] !== undefined).map((field) => [field, rounded(rates[field]!)])
    )
  };
}

function entryOf(entry: z.output<typeof Entry>): SnapshotEntry {
  const optional = (value: number | undefined) => (value === undefined ? undefined : rounded(value));
  const cacheWrite = optional(entry.cache_creation_input_token_cost);
  const cacheWrite1h = optional(entry.cache_creation_input_token_cost_above_1hr);
  const cacheRead = optional(entry.cache_read_input_token_cost);
  const tier = tierOf(entry);
  return {
    input_cost_per_token: rounded(entry.input_cost_per_token),
    output_cost_per_token: rounded(entry.output_cost_per_token),
    ...(cacheWrite === undefined ? {} : { cache_creation_input_token_cost: cacheWrite }),
    ...(cacheWrite1h === undefined ? {} : { cache_creation_input_token_cost_above_1hr: cacheWrite1h }),
    ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
    ...(tier === undefined ? {} : { long_context: tier })
  };
}

/**
 * The entries of LiteLLM's `model_prices_and_context_window.json` that the snapshot keeps, by model name: the chat and
 * responses models of `PROVIDERS` that have an input and an output price.
 *
 * Names follow three rules:
 * - An entry's own `<litellm_provider>/` prefix is dropped (`xai/grok-4.20` becomes `grok-4.20`). LiteLLM keys most
 *   Gemini, xAI, Z.ai, Moonshot and MiniMax models only that way, but agents record the bare model name, and
 *   `createPricing` matches a bare key to a prefixed id, never a prefixed key to a bare id.
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

/**
 * The LiteLLM source of a snapshot, from the latest commit in GitHub's commit listing of the LiteLLM file: the commit
 * to read the list from, and the `<date>+<commit>` head its version carries (`snapshotVersion` appends the digest).
 */
export function versionOf(commits: unknown): { commit: string; version: string } {
  const [{ sha, commit }] = z.parse(Commits, commits);
  // An ISO datetime without an offset is in UTC, which GitHub always uses.
  return { commit: sha, version: `${commit.committer.date.slice(0, 10)}+${sha}` };
}

/**
 * Deterministic JSON of a value: every object's keys sorted, so a digest of it covers the content and not the order
 * LiteLLM's list or the snapshot happens to name it in. Format and string encoding are JSON's own.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}}`;
  }
  return JSON.stringify(value);
}

/**
 * The first 12 hex digits of the SHA-256 of the prices' deterministic JSON: a name for the table's content itself, so
 * the version changes whenever the prices the snapshot keeps change — a field newly kept under the same LiteLLM commit
 * included — and a host can tell a table that would price stored data differently from one that would not.
 */
export function priceDigest(prices: Record<string, SnapshotEntry>): string {
  return createHash("sha256").update(stableJson(prices)).digest("hex").slice(0, 12);
}

/** A snapshot's version: the LiteLLM source `versionOf` names, then the prices' digest. */
export function snapshotVersion(version: string, prices: Record<string, SnapshotEntry>): string {
  return `${version}+${priceDigest(prices)}`;
}

export function formatSnapshot(snapshot: Snapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

/**
 * The snapshot file's next text, or `undefined` when the version `current` carries ends in these prices' digest: the
 * digest covers the prices' content and not their key order, so a new LiteLLM commit that changes no price kept here,
 * or LiteLLM listing an entry's fields in another order, is not an update, and the file keeps naming the commit the
 * prices were taken from. A version that ends in any other digest names a different table, and the file is rewritten
 * under `version`.
 */
export function nextSnapshot(
  current: string | undefined,
  prices: Record<string, SnapshotEntry>,
  version: string
): string | undefined {
  if (current !== undefined) {
    const held = Current.safeParse(JSON.parse(current));
    if (held.success && held.data.version.endsWith(`+${priceDigest(prices)}`)) {
      return undefined;
    }
  }
  return formatSnapshot({ version, prices });
}
