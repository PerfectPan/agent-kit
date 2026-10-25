import { use, useLayoutEffect } from "react";
import { Callout } from "fumadocs-ui/components/callout";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";

import { apiSymbolToc } from "../lib/api-page.ts";
import { clearDocsPending } from "../lib/lang-preference.ts";
import type { Lang } from "../lib/landing-copy.ts";
import { docs } from "../lib/source.ts";

export function DocsArticle({ path, fallback, lang }: { path: string; fallback: boolean; lang: Lang }) {
  const page = docs.getPage(path);
  if (!page) {
    throw new Error(`unknown page: ${path}`);
  }

  const loaded = use(page.load());
  const MDX = page.body;

  useLayoutEffect(() => {
    if (lang === "zh") {
      clearDocsPending();
    }
  }, [path, lang]);

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
