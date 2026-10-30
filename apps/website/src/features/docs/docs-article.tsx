import { use } from "react";
import { Callout } from "fumadocs-ui/components/callout";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";

import { apiSymbolToc } from "./api-page.ts";
import { DOCS_PENDING_CLASS } from "../i18n/index.ts";
import { useDocumentReady } from "../../hooks/use-document-ready.ts";
import type { Lang } from "../../lib/language.ts";
import { docs } from "./source.ts";

export function DocsArticle({ path, fallback, lang }: { path: string; fallback: boolean; lang: Lang }) {
  const page = docs.getPage(path);
  if (!page) {
    throw new Error(`unknown page: ${path}`);
  }

  const loaded = use(page.load());
  const MDX = page.body;

  useDocumentReady(path, lang === "zh", DOCS_PENDING_CLASS);

  return (
    <DocsPage toc={apiSymbolToc(path, loaded.toc)} tableOfContent={{ single: true }}>
      <DocsTitle
        className={`text-[2.375rem] leading-[1.15] font-[750] tracking-[-0.03em] text-balance ${lang === "zh" ? "break-keep" : ""}`}
      >
        {page.title}
      </DocsTitle>
      {page.description === undefined ? null : <DocsDescription>{page.description}</DocsDescription>}
      <DocsBody
        className={`max-w-[72ch] text-[1.0625rem] leading-[1.7] text-pretty ${lang === "zh" ? "[line-break:strict]" : ""}`}
      >
        {fallback ? <Callout>此页尚无中文译本，以下为英文原文。</Callout> : null}
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}
