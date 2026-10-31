import { notFound } from "@tanstack/react-router";
import { Suspense } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import { englishFallback } from "./docs-fallback.ts";
import { slugsFromSplat } from "./docs-path.ts";
import { baseOptions } from "./layout-shared.ts";
import { source } from "./source.ts";
import { DocsArticle } from "./docs-article.tsx";
import { DocsSidebarFooter } from "./docs-sidebar-footer.tsx";
import { useLanguage } from "../../hooks/use-language.ts";

export function DocsScreen({ splat }: { splat?: string }) {
  const { lang } = useLanguage();
  const slugs = slugsFromSplat(splat);
  const page = source.getPage(slugs, lang);
  if (!page) {
    throw notFound();
  }

  return (
    // Hidden until the Chinese page is ready. Tailwind needs DOCS_PENDING_CLASS spelled out here.
    <div className="in-[.ak-docs-pending]:invisible">
      <DocsLayout
        {...baseOptions()}
        tree={source.getPageTree(lang)}
        // The sidebar sits on the page colour rather than a white card, so a hairline is enough to separate it.
        sidebar={{
          className: "bg-fd-background border-e-fd-border/60",
          footer: <DocsSidebarFooter />
        }}
      >
        <Suspense>
          <DocsArticle path={page.path} fallback={englishFallback(lang, page.path)} lang={lang} />
        </Suspense>
      </DocsLayout>
    </div>
  );
}
