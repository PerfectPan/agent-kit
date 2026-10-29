import { expect, it } from "vite-plus/test";

import { apiSidebarLabel, apiSymbolToc } from "./api-page.ts";

it("labels an API page with its export subpath", () => {
  expect(apiSidebarLabel("@rivus/agent-kit/sessions")).toBe("/sessions");
  expect(apiSidebarLabel("@rivus/agent-kit/harness/events")).toBe("/harness/events");
  expect(apiSidebarLabel("@rivus/agent-kit-collab/process-lock")).toBe("/process-lock");
  expect(apiSidebarLabel("API reference")).toBeUndefined();
});

it("keeps only kind headings and symbol names in an API table of contents", () => {
  const toc = [
    { title: "Functions", depth: 2 },
    { title: "listSessions()", depth: 3 },
    { title: "Parameters", depth: 4 },
    { title: "options?", depth: 5 }
  ];
  expect(apiSymbolToc("en/api/sessions.mdx", toc)).toEqual([
    { title: "Functions", depth: 2 },
    { title: "listSessions()", depth: 3 }
  ]);
  expect(apiSymbolToc("api/sessions.mdx", toc)).toHaveLength(2);
  expect(apiSymbolToc("en/connection/discovery.mdx", toc)).toEqual(toc);
});
