import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_ARTIFACT_BYTES, unpackArtifact } from "./pages-artifact.ts";

const MARKER = "<!-- agent-kit-pages-preview -->";

interface PullRequest {
  number: number;
  state: string;
  base: { repo: { full_name: string } };
  head: { repo: { id: number } | null; ref: string; sha: string };
}

interface WorkflowRun {
  id: number;
  event: string;
  conclusion: string;
  path: string;
  repository: { full_name: string };
  head_sha: string;
  head_repository: { id: number };
  head_branch: string;
  pull_requests: { number: number }[];
}

interface PagesInput {
  mode: "main" | "preview" | "cleanup";
  repo: string;
  token: string;
  event: { action?: string; pull_request?: { number: number }; workflow_run?: WorkflowRun };
  sha: string | undefined;
  runId: string | undefined;
}

function git(branch: string, ...args: string[]): string {
  return execFileSync("git", ["-C", branch, ...args], { encoding: "utf8" }).trim();
}

function remove(path: string): void {
  assert(!lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink(), "Publishing destination contains a symlink");
  rmSync(path, { recursive: true, force: true });
}

function rejectLinks(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    assert(!entry.isSymbolicLink(), "Publishing branch contains a symlink");
    if (entry.isDirectory()) {
      rejectLinks(join(directory, entry.name));
    }
  }
}

export function copySite(source: string, branch: string, number: number): void {
  rejectLinks(branch);
  const destination = number ? join(branch, "pr-preview", `pr-${number}`) : branch;
  if (number) {
    remove(destination);
    mkdirSync(destination, { recursive: true });
  } else {
    for (const entry of readdirSync(branch)) {
      if (entry !== ".git" && entry !== "pr-preview") {
        remove(join(branch, entry));
      }
    }
  }
  cpSync(source, destination, { recursive: true });
  writeFileSync(join(branch, ".nojekyll"), "", { flag: "a" });
}

export function removePreview(branch: string, number: number): void {
  assert(
    !lstatSync(join(branch, "pr-preview"), { throwIfNoEntry: false })?.isSymbolicLink(),
    "Preview directory is a symlink"
  );
  remove(join(branch, "pr-preview", `pr-${number}`));
}

/** Only trusted default-branch code calls this entry; event and artifact contents are data. */
export async function runPages(input: PagesInput): Promise<void> {
  const { repo, token, mode, event } = input;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  async function api<T>(endpoint: string, method = "GET", data?: { body: string }): Promise<T> {
    const response = await fetch(`https://api.github.com/repos/${repo}/${endpoint}`, {
      method,
      headers,
      redirect: "error",
      ...(data ? { body: JSON.stringify(data) } : {})
    });
    assert(response.ok, `GitHub API ${method} ${endpoint} failed (${response.status})`);
    return (await response.json()) as T;
  }
  async function* items<T>(endpoint: string, key?: string): AsyncGenerator<T> {
    for (let page = 1; ; page += 1) {
      const result = await api<T[] | Record<string, T[]>>(`${endpoint}?per_page=100&page=${page}`);
      const batch = key ? (result as Record<string, T[]>)[key]! : (result as T[]);
      yield* batch;
      if (batch.length < 100) {
        return;
      }
    }
  }
  async function comment(number: number, closed: boolean): Promise<void> {
    let previous: { id: number } | undefined;
    for await (const entry of items<{ id: number; body: string | null; user: { login: string; type: string } }>(
      `issues/${number}/comments`
    )) {
      if (entry.user.login === "github-actions[bot]" && entry.user.type === "Bot" && entry.body?.includes(MARKER)) {
        previous = entry;
        break;
      }
    }
    if (closed && !previous) {
      return;
    }
    const [owner, name] = repo.split("/");
    const url = `https://${owner!.toLowerCase()}.github.io/${name}/pr-preview/pr-${number}/`;
    const body = closed
      ? `${MARKER}\nPreview of #${number} removed (pull request closed).`
      : `${MARKER}\nPreview of #${number}: ${url}\n\nThe static files are published to gh-pages; Pages may take a few minutes to update.`;
    if (previous) {
      await api(`issues/comments/${previous.id}`, "PATCH", { body });
    } else {
      await api(`issues/${number}/comments`, "POST", { body });
    }
  }
  async function publish(
    source: string | undefined,
    number: number,
    stillCurrent: () => Promise<boolean>,
    closed = false
  ): Promise<boolean> {
    const branch = mkdtempSync(join(tmpdir(), "pages-branch-"));
    try {
      git(branch, "init", "--initial-branch=gh-pages");
      git(branch, "remote", "add", "origin", `https://github.com/${repo}.git`);
      const remote = git(branch, "ls-remote", "--heads", "origin", "refs/heads/gh-pages");
      if (remote) {
        git(branch, "fetch", "--depth=1", "origin", "gh-pages");
        git(branch, "checkout", "-B", "gh-pages", "FETCH_HEAD");
      }
      if (!(await stillCurrent())) {
        console.log("Skipped: PR state or branch head changed while waiting.");
        return false;
      }
      if (closed) {
        removePreview(branch, number);
      } else {
        assert(source, "Missing site source");
        copySite(source, branch, number);
      }
      git(branch, "add", "--all");
      if (git(branch, "diff", "--cached", "--name-only")) {
        git(
          branch,
          "-c",
          "user.name=github-actions[bot]",
          "-c",
          "user.email=41898282+github-actions[bot]@users.noreply.github.com",
          "commit",
          "-m",
          `docs(pages): ${closed ? "remove" : "publish"} ${number ? `preview ${number}` : "site"}`
        );
        // A normal fast-forward push fails safely if a writer outside the workflow lock intervenes.
        git(branch, "push", "origin", "HEAD:gh-pages");
      }
      // A token-authenticated push does not trigger branch Pages. Retry even when a previous push
      // succeeded but its build request failed; no branch exists when cleanup precedes any publication.
      if (!closed || remote) {
        await api("pages/builds", "POST");
      }
      return true;
    } finally {
      rmSync(branch, { recursive: true, force: true });
    }
  }
  if (mode === "cleanup") {
    const number = event.pull_request?.number;
    assert(
      typeof number === "number" && Number.isSafeInteger(number) && number > 0 && event.action === "closed",
      "Invalid close event"
    );
    if (
      await publish(undefined, number, async () => (await api<PullRequest>(`pulls/${number}`)).state === "closed", true)
    ) {
      await comment(number, true);
    }
    return;
  }
  const preview = mode === "preview";
  const run = event.workflow_run;
  if (preview) {
    assert(
      run &&
        run.event === "pull_request" &&
        run.conclusion === "success" &&
        run.repository.full_name === repo &&
        run.path === ".github/workflows/pages.yml",
      "Unexpected source workflow"
    );
  }
  const sha = preview ? run!.head_sha : input.sha;
  const runId = preview ? run!.id : input.runId;
  assert(sha && runId, "Missing source run identity");
  interface Artifact {
    id: number;
    name: string;
    expired: boolean;
    size_in_bytes: number;
  }
  const artifacts: Artifact[] = [];
  for await (const artifact of items<Artifact>(`actions/runs/${runId}/artifacts`, "artifacts")) {
    if (artifact.name === "pages-site" && !artifact.expired) {
      artifacts.push(artifact);
    }
  }
  assert(artifacts.length === 1, "Expected exactly one unexpired pages-site artifact");
  const artifact = artifacts[0]!;
  assert(artifact.size_in_bytes <= MAX_ARTIFACT_BYTES, "Artifact download is too large");
  let response = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${artifact.id}/zip`, {
    headers,
    redirect: "manual"
  });
  if (response.status === 302) {
    const location = response.headers.get("location");
    assert(location && new URL(location).protocol === "https:", "Invalid artifact redirect");
    // The signed storage URL must never receive the GitHub bearer token.
    response = await fetch(location, { redirect: "error" });
  }
  assert(response.ok && response.body, `Artifact download failed (${response.status})`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= MAX_ARTIFACT_BYTES, "Artifact download is too large");
    chunks.push(chunk);
  }
  const root = mkdtempSync(join(tmpdir(), "pages-artifact-"));
  try {
    const number = unpackArtifact(Buffer.concat(chunks), root, sha, preview);
    const current = (pr: PullRequest) => pr.state === "open" && pr.head.sha === sha;
    if (preview) {
      const candidates = [...run!.pull_requests];
      if (candidates.length === 0) {
        for await (const candidate of items<{ number: number }>(`commits/${sha}/pulls`)) {
          candidates.push(candidate);
        }
      }
      assert(
        candidates.some((candidate) => candidate.number === number),
        "Artifact PR is not associated with the triggering head SHA"
      );
      const pr = await api<PullRequest>(`pulls/${number}`);
      assert(
        pr.base.repo.full_name === repo &&
          pr.head.repo?.id === run!.head_repository.id &&
          pr.head.ref === run!.head_branch,
        "PR does not belong to the triggering repository and branch"
      );
      if (!current(pr)) {
        console.log("Skipped: preview is closed or superseded.");
        return;
      }
    }
    const stillCurrent = preview
      ? async () => current(await api<PullRequest>(`pulls/${number}`))
      : async () => (await api<{ object: { sha: string } }>("git/ref/heads/main")).object.sha === sha;
    if ((await publish(join(root, "site"), number, stillCurrent)) && preview) {
      await comment(number, false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
