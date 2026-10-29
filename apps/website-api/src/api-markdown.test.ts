import { expect, it } from "vite-plus/test";

import { apiIndexBody, apiMetaPages, rewriteApiLinks, stripFrontmatter, withFrontmatter } from "./api-markdown.ts";

it("drops one leading frontmatter block", () => {
  expect(stripFrontmatter("---\ntitle: old\n---\n\n## Functions\n")).toBe("## Functions\n");
  expect(stripFrontmatter("## Functions\n")).toBe("## Functions\n");
});

it("rewrites TypeDoc mdx links onto docs routes", () => {
  const markdown =
    "See [Platform](platform.mdx#platform) and [events](harness/events.mdx#readhookevent) and [here](#listsessions).";
  expect(rewriteApiLinks(markdown)).toBe(
    "See [Platform](/docs/api/platform#platform) and [events](/docs/api/harness-events#readhookevent) and [here](#listsessions)."
  );
});

it("writes frontmatter and one index line per entry", () => {
  const page = withFrontmatter(
    "## Functions\n\n`listSessions`",
    "@rivus/agent-kit/sessions",
    "`listSessions`, `SessionAdapter` — anywhere"
  );
  expect(page.startsWith('---\ntitle: "@rivus/agent-kit/sessions"\n')).toBe(true);
  expect(page).toContain('description: "listSessions, SessionAdapter — anywhere"');
  expect(page).toContain("`listSessions`");
  const groups = [
    {
      packageName: "@rivus/agent-kit",
      entries: [{ specifier: "@rivus/agent-kit/sessions", slug: "sessions", blurb: "`listSessions` — anywhere" }]
    },
    {
      packageName: "@rivus/agent-kit-collab",
      entries: [
        {
          specifier: "@rivus/agent-kit-collab/process-lock",
          slug: "process-lock",
          blurb: "`acquireProcessLock` — plain TS"
        }
      ]
    }
  ];
  const index = apiIndexBody(groups);
  expect(index).toContain("[`@rivus/agent-kit/sessions`](/docs/api/sessions) — `listSessions` — anywhere");
  expect(apiMetaPages(groups)).toEqual([
    "index",
    "---@rivus/agent-kit---",
    "sessions",
    "---@rivus/agent-kit-collab---",
    "process-lock"
  ]);
});
