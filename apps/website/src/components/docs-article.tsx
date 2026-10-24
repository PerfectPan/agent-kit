import { use } from "react";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";

import { docs } from "../lib/source.ts";

export function DocsArticle({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) {
    throw new Error(`unknown page: ${path}`);
  }

  const loaded = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={loaded.toc}>
      <DocsTitle>{page.title}</DocsTitle>
      {page.description === undefined ? null : <DocsDescription>{page.description}</DocsDescription>}
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}
