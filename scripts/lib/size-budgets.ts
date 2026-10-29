import * as z from "zod/mini";

/** The packages whose `.size-limit.ts` budgets `pnpm size:update` maintains, relative to the repository root. */
export const SIZE_LIMIT_PACKAGES: readonly string[] = ["packages/agent-kit", "packages/agent-kit-collab"];

const MIN_HEADROOM_BYTES = 256;
const HEADROOM_RATIO = 0.02;

// The LiteLLM snapshot grows by about 10 B a model, and the weekly snapshot PR should pass when LiteLLM adds a few
// dozen models.
const MIN_HEADROOM_OVERRIDES: Readonly<Record<string, number>> = { "@rivus/agent-kit/cost/prices": 512 };

/**
 * The budget for entry `name` measured at `size` bytes: the size plus 2%, at least 256 B. The headroom lets small
 * dependency updates pass without a budget change, while growth beyond it still fails the check.
 */
export function budgetFor(name: string, size: number): number {
  const minimum = MIN_HEADROOM_OVERRIDES[name] ?? MIN_HEADROOM_BYTES;
  return size + Math.max(Math.ceil(size * HEADROOM_RATIO), minimum);
}

const Measurements = z.array(z.object({ name: z.string(), size: z.number() }));

/** One entry of `size-limit --json` output. */
export type MeasuredEntry = z.infer<typeof Measurements>[number];

/** Reads `size-limit --json` output; an entry without a size, such as one that failed to bundle, throws. */
export function parseMeasurements(json: string): MeasuredEntry[] {
  return Measurements.parse(JSON.parse(json));
}

const LIMIT = /limit: "\d+ B"/;

/**
 * Sets the `limit` of every measured entry in a `.size-limit.ts` source to its budget and keeps everything else.
 * Each entry sits on one line with its `name` and a `limit: "<n> B"`; a name without exactly one such line throws
 * rather than leaving a stale budget.
 */
export function rewriteLimits(source: string, entries: readonly MeasuredEntry[]): string {
  const lines = source.split("\n");
  for (const { name, size } of entries) {
    const key = `name: ${JSON.stringify(name)},`;
    const matches = lines.flatMap((line, index) => (line.includes(key) && LIMIT.test(line) ? [index] : []));
    if (matches.length !== 1) {
      throw new Error(`expected one line with ${key} and a limit: "<n> B", found ${matches.length}`);
    }
    const index = matches[0]!;
    lines[index] = lines[index]!.replace(LIMIT, `limit: "${budgetFor(name, size)} B"`);
  }
  return lines.join("\n");
}
