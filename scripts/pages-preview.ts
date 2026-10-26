import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runPages } from "./lib/pages-preview.ts";

const mode = process.argv[2];
assert(
  mode === "main" || mode === "preview" || mode === "cleanup",
  "Usage: node scripts/pages-preview.ts main|preview|cleanup"
);
const repo = process.env.GITHUB_REPOSITORY;
const eventPath = process.env.GITHUB_EVENT_PATH;
const token = process.env.GH_TOKEN;
assert(repo && eventPath && token, "GITHUB_REPOSITORY, GITHUB_EVENT_PATH and GH_TOKEN are required");
await runPages({
  mode,
  repo,
  token,
  event: JSON.parse(readFileSync(eventPath, "utf8")),
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID
});
