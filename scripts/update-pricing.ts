import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { nextSnapshot, selectPrices, versionOf } from "./lib/litellm-snapshot.ts";
import { findRepositoryRoot } from "./lib/workspace.ts";

const USAGE = `usage: node scripts/update-pricing.ts
Regenerates the LiteLLM price snapshot of /cost/prices from the latest commit of LiteLLM's price list and leaves the
file as it is when no price it keeps has changed. GITHUB_TOKEN, when set, authenticates the GitHub API request.`;

const LITELLM = "BerriAI/litellm";
const FILE = "model_prices_and_context_window.json";
const SNAPSHOT = "packages/cost/src/domain/pricing/adapters/litellm-snapshot.json";

const { values } = parseArgs({ options: { help: { type: "boolean", short: "h" } } });
if (values.help === true) {
  console.log(USAGE);
  process.exit(0);
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

const token = process.env["GITHUB_TOKEN"];
// The latest commit that changed the file, and the file at that commit, so the version names exactly the prices read.
const { commit, version } = versionOf(
  await getJson(`https://api.github.com/repos/${LITELLM}/commits?path=${FILE}&per_page=1`, {
    accept: "application/vnd.github+json",
    ...(token === undefined || token === "" ? {} : { authorization: `Bearer ${token}` })
  })
);
const prices = selectPrices(await getJson(`https://raw.githubusercontent.com/${LITELLM}/${commit}/${FILE}`));

const file = join(findRepositoryRoot(), SNAPSHOT);
const text = nextSnapshot(existsSync(file) ? readFileSync(file, "utf8") : undefined, prices, version);
const models = Object.keys(prices).length;
if (text === undefined) {
  console.log(`${SNAPSHOT}: unchanged, ${models} models; LiteLLM ${commit} changed no price it keeps`);
} else {
  writeFileSync(file, text);
  console.log(`${SNAPSHOT}: ${models} models, version ${version}`);
}
