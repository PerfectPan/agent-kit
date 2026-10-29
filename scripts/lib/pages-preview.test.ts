import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { archive, SHA } from "./pages-artifact.test-support.ts";
import { MAX_ARTIFACT_BYTES } from "./pages-artifact.ts";
import { copySite, removePreview, runPages } from "./pages-preview.ts";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn<typeof execFileSync>() }));
const MARKER = "<!-- agent-kit-pages-preview -->";
const repo = "owner/repo";
const json = (value: unknown) => Response.json(value);
const git = vi.mocked(execFileSync);
let root: string;
let pr: {
  number: number;
  state: string;
  base: { repo: { full_name: string } };
  head: { repo: { id: number } | null; ref: string; sha: string };
};
let comments: { id: number; user: { login: string; type: string }; body: string | null }[];
let artifacts: { id: number; name: string; expired: boolean; size_in_bytes: number }[];
let payload: Buffer;
let changed: boolean;
let branchSnapshot: Record<string, string>;
const requests: { path: string; method: string; body: string | undefined }[] = [];
const fetchMock = vi.fn<typeof fetch>();

function input(mode: "main" | "preview" | "cleanup" = "preview") {
  return {
    mode,
    repo,
    token: "test-token",
    sha: SHA,
    runId: "10",
    event: {
      action: "closed",
      pull_request: { number: 215 },
      workflow_run: {
        id: 10,
        event: "pull_request",
        conclusion: "success",
        path: ".github/workflows/pages.yml",
        repository: { full_name: repo },
        head_sha: SHA,
        head_repository: { id: 2 },
        head_branch: "feature",
        pull_requests: [] as { number: number }[]
      }
    }
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pages-publish-test-"));
  pr = {
    number: 215,
    state: "open",
    base: { repo: { full_name: repo } },
    head: { repo: { id: 2 }, sha: SHA, ref: "feature" }
  };
  comments = [];
  artifacts = [{ id: 1, name: "pages-site", expired: false, size_in_bytes: 100 }];
  payload = archive();
  changed = true;
  branchSnapshot = {};
  requests.length = 0;
  git.mockReset();
  git.mockImplementation((_file, args) => {
    const arguments_ = args as string[];
    const branch = arguments_[1]!;
    if (arguments_[2] === "ls-remote") {
      return "head refs/heads/gh-pages";
    }
    if (arguments_[2] === "diff") {
      return changed ? "index.html" : "";
    }
    if (arguments_[2] === "push") {
      for (const path of ["index.html", "pr-preview/pr-215/index.html"]) {
        if (existsSync(join(branch, path))) {
          branchSnapshot[path] = readFileSync(join(branch, path), "utf8");
        }
      }
    }
    return "";
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, options) => {
    const path = (url instanceof Request ? url.url : url.toString()).replace(
      `https://api.github.com/repos/${repo}/`,
      ""
    );
    const method = options?.method ?? "GET";
    requests.push({ path, method, body: options?.body as string | undefined });
    if (path.startsWith("actions/runs/")) {
      return json({ artifacts });
    }
    if (path.endsWith("/zip")) {
      return new Response(new Uint8Array(payload));
    }
    if (path.startsWith("commits/")) {
      return json([{ number: 215 }]);
    }
    if (path.startsWith("pulls/")) {
      return json(pr);
    }
    if (path.startsWith("issues/") && method === "GET") {
      return json(comments);
    }
    if (path === "git/ref/heads/main") {
      return json({ object: { sha: SHA } });
    }
    if (method !== "GET") {
      return json({});
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("publishing directories", () => {
  function directories() {
    const source = join(root, "source");
    const branch = join(root, "branch");
    mkdirSync(source);
    mkdirSync(branch);
    writeFileSync(join(source, "index.html"), "preview");
    writeFileSync(join(branch, "index.html"), "main");
    return { source, branch };
  }
  it("main preserves all previews and removes old production files", () => {
    const { source, branch } = directories();
    copySite(source, branch, 215);
    writeFileSync(join(branch, "old.html"), "old");
    writeFileSync(join(source, "index.html"), "new main");
    copySite(source, branch, 0);
    expect(readFileSync(join(branch, "pr-preview/pr-215/index.html"), "utf8")).toBe("preview");
    expect(readFileSync(join(branch, "index.html"), "utf8")).toBe("new main");
    expect(existsSync(join(branch, "old.html"))).toBe(false);
    expect(existsSync(join(branch, ".nojekyll"))).toBe(true);
  });
  it("preview replacement and cleanup preserve production and siblings", () => {
    const { source, branch } = directories();
    copySite(source, branch, 214);
    copySite(source, branch, 215);
    writeFileSync(join(branch, "pr-preview/pr-215/old.html"), "old");
    copySite(source, branch, 215);
    expect(existsSync(join(branch, "pr-preview/pr-215/old.html"))).toBe(false);
    removePreview(branch, 215);
    expect(readFileSync(join(branch, "index.html"), "utf8")).toBe("main");
    expect(readFileSync(join(branch, "pr-preview/pr-214/index.html"), "utf8")).toBe("preview");
  });
  it("rejects destination symlinks in publishing and cleanup", () => {
    const { source, branch } = directories();
    symlinkSync(source, join(branch, "pr-preview"));
    expect(() => copySite(source, branch, 215)).toThrow(/symlink/u);
    expect(() => removePreview(branch, 215)).toThrow(/symlink/u);
  });
});

describe("trusted publication", () => {
  it("resolves fork PRs by head SHA, publishes and creates a marker comment", async () => {
    await runPages(input());
    expect(requests).toContainEqual(expect.objectContaining({ path: `commits/${SHA}/pulls?per_page=100&page=1` }));
    expect(branchSnapshot["pr-preview/pr-215/index.html"]).toContain("Preview");
    expect(requests).toContainEqual(expect.objectContaining({ path: "pages/builds", method: "POST" }));
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: "issues/215/comments",
        method: "POST",
        body: expect.stringContaining("/repo/pr-preview/pr-215/")
      })
    );
  });
  it("uses the event PR list when present and rejects unrelated numbers", async () => {
    const options = input();
    options.event.workflow_run.pull_requests = [{ number: 216 }];
    await expect(runPages(options)).rejects.toThrow(/not associated/u);
    expect(requests.some(({ path }) => path.startsWith("commits/"))).toBe(false);
    expect(git).not.toHaveBeenCalled();
  });
  it("paginates fork lookup and marker comments", async () => {
    const implementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, options) => {
      const endpoint = url instanceof Request ? url.url : url.toString();
      if (endpoint.includes(`/commits/${SHA}/pulls?`)) {
        return json(
          endpoint.endsWith("page=1") ? Array.from({ length: 100 }, (_, number) => ({ number })) : [{ number: 215 }]
        );
      }
      if (endpoint.includes("issues/215/comments?") && endpoint.endsWith("page=1")) {
        return json(
          Array.from({ length: 100 }, (_, id) => ({ id, user: { login: "someone", type: "User" }, body: MARKER }))
        );
      }
      return implementation(url, options);
    });
    comments = [{ id: 101, user: { login: "github-actions[bot]", type: "Bot" }, body: MARKER }];
    await runPages(input());
    expect(requests.at(-1)).toEqual(expect.objectContaining({ path: "issues/comments/101", method: "PATCH" }));
  });
  it.each(["base", "repository", "deleted", "branch"])("rejects mismatched %s identity", async (part) => {
    if (part === "base") {
      pr.base.repo.full_name = "elsewhere/repo";
    }
    if (part === "repository") {
      pr.head.repo = { id: 3 };
    }
    if (part === "deleted") {
      pr.head.repo = null;
    }
    if (part === "branch") {
      pr.head.ref = "other";
    }
    await expect(runPages(input())).rejects.toThrow(/does not belong/u);
    expect(git).not.toHaveBeenCalled();
  });
  it.each(["closed", "superseded"])("skips %s PR runs", async (state) => {
    if (state === "closed") {
      pr.state = "closed";
    } else {
      pr.head.sha = "b".repeat(40);
    }
    await runPages(input());
    expect(git).not.toHaveBeenCalled();
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });
  it("rechecks state after fetching the publication branch", async () => {
    git.mockImplementation((_file, args) => {
      if ((args as string[]).includes("ls-remote")) {
        pr.state = "closed";
      }
      return "";
    });
    await runPages(input());
    expect(git.mock.calls.some(([, args]) => (args as string[]).includes("--all"))).toBe(false);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });
  it("updates only the Actions bot's marker comment", async () => {
    comments = [
      { id: 1, user: { login: "someone", type: "User" }, body: MARKER },
      { id: 2, user: { login: "github-actions[bot]", type: "Bot" }, body: "other workflow" },
      { id: 3, user: { login: "github-actions[bot]", type: "Bot" }, body: MARKER }
    ];
    await runPages(input());
    expect(requests.filter(({ path, method }) => path.startsWith("issues/") && method !== "GET")).toEqual([
      expect.objectContaining({ path: "issues/comments/3", method: "PATCH", body: expect.stringContaining(MARKER) })
    ]);
    pr.state = "closed";
    await runPages(input("cleanup"));
    expect(requests.at(-1)).toEqual(
      expect.objectContaining({ path: "issues/comments/3", method: "PATCH", body: expect.stringContaining("removed") })
    );
  });
  it("cleanup downloads no artifact and creates no comment for a PR without a preview", async () => {
    pr.state = "closed";
    await runPages(input("cleanup"));
    expect(requests.some(({ path }) => path.startsWith("actions/"))).toBe(false);
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([
      { path: "pages/builds", method: "POST", body: undefined }
    ]);
  });
  it("cleanup before the first publication needs no Pages build", async () => {
    pr.state = "closed";
    git.mockReturnValue("");
    await runPages(input("cleanup"));
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });
  it("skips cleanup for reopened PRs and rejects noninteger close events", async () => {
    await runPages(input("cleanup"));
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
    const options = input("cleanup");
    options.event.pull_request.number = 215.5;
    await expect(runPages(options)).rejects.toThrow(/Invalid close event/u);
  });
  it("publishes production at the root without commenting", async () => {
    payload = archive([], 0);
    await runPages(input("main"));
    expect(branchSnapshot["index.html"]).toContain("Preview");
    expect(requests.some(({ path }) => path.startsWith("issues/"))).toBe(false);
  });
  it("retries failed Pages builds even when the branch contents have not changed", async () => {
    const implementation = fetchMock.getMockImplementation()!;
    let fail = true;
    fetchMock.mockImplementation(async (url, options) => {
      if ((url instanceof Request ? url.url : url.toString()).endsWith("pages/builds") && fail) {
        fail = false;
        return new Response(null, { status: 403 });
      }
      return implementation(url, options);
    });
    await expect(runPages(input())).rejects.toThrow(/403/u);
    changed = false;
    git.mockClear();
    await runPages(input());
    expect(git.mock.calls.some(([, args]) => (args as string[]).includes("push"))).toBe(false);
    expect(requests).toContainEqual(expect.objectContaining({ path: "pages/builds", method: "POST" }));
  });
  it("does not request Pages or comment after a failed push", async () => {
    const implementation = git.getMockImplementation()!;
    git.mockImplementation((...args) => {
      if ((args[1] as string[]).includes("push")) {
        throw new Error("non-fast-forward");
      }
      return implementation(...args);
    });
    await expect(runPages(input())).rejects.toThrow(/non-fast-forward/u);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
  });
  it("rejects unexpected source workflows before API access", async () => {
    const options = input();
    options.event.workflow_run.path = ".github/workflows/other.yml";
    await expect(runPages(options)).rejects.toThrow(/Unexpected source/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["expired", "duplicate", "oversized"])("rejects %s artifacts", async (kind) => {
    if (kind === "expired") {
      artifacts[0]!.expired = true;
    }
    if (kind === "duplicate") {
      artifacts.push({ ...artifacts[0]! });
    }
    if (kind === "oversized") {
      artifacts[0]!.size_in_bytes = MAX_ARTIFACT_BYTES + 1;
    }
    await expect(runPages(input())).rejects.toThrow(/artifact/iu);
    expect(git).not.toHaveBeenCalled();
  });
  it("does not forward authorization to the artifact storage redirect", async () => {
    const implementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, options) => {
      if ((url instanceof Request ? url.url : url.toString()).endsWith("/zip")) {
        return new Response(null, { status: 302, headers: { location: "https://storage.example/artifact" } });
      }
      if ((url instanceof Request ? url.url : url.toString()) === "https://storage.example/artifact") {
        expect(options?.headers).toBeUndefined();
        return new Response(new Uint8Array(payload));
      }
      return implementation(url, options);
    });
    await runPages(input());
  });
});
