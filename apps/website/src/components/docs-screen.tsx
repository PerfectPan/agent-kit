import { notFound } from "@tanstack/react-router";
import { Suspense } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { englishFallback } from "../lib/docs-fallback.ts";
import { slugsFromSplat } from "../lib/docs-path.ts";
import { baseOptions } from "../lib/layout-shared.ts";
import { source } from "../lib/source.ts";
import { DocsArticle } from "./docs-article.tsx";
import { useLanguage } from "./root-shell.tsx";

export function DocsScreen({ splat }: { splat?: string }) {
  const { lang } = useLanguage();
  const slugs = slugsFromSplat(splat);
  const page = source.getPage(slugs, lang);
  if (!page) {
    throw notFound();
  }

  return (
    <div data-docs-shell="">
      <DocsLayout {...baseOptions()} tree={source.getPageTree(lang)}>
        <Suspense>
          <DocsArticle path={page.path} fallback={englishFallback(lang, page.path)} lang={lang} />
        </Suspense>
      </DocsLayout>
    </div>
  );
}
