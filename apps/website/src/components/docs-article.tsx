import { use } from "react";
import { Callout } from "fumadocs-ui/components/callout";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";

import { apiSymbolToc } from "../lib/api-page.ts";
import { docs } from "../lib/source.ts";

export function DocsArticle({ path, fallback }: { path: string; fallback: boolean }) {
  const page = docs.getPage(path);
  if (!page) {
    throw new Error(`unknown page: ${path}`);
  }

  const loaded = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={apiSymbolToc(path, loaded.toc)}>
      <DocsTitle>{page.title}</DocsTitle>
      {page.description === undefined ? null : <DocsDescription>{page.description}</DocsDescription>}
      <DocsBody>
        {fallback ? <Callout>此页尚无中文译本，以下为英文原文。</Callout> : null}
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}
