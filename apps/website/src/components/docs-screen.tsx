import type { Serialized } from "fumadocs-core/source/client";
import { Suspense } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";

import type { loadDocsPage } from "../lib/docs-loader.ts";
import { baseOptions } from "../lib/layout-shared.ts";
import { DocsArticle } from "./docs-article.tsx";

type DocsLoaderData = Serialized<Awaited<ReturnType<typeof loadDocsPage>>>;

export function DocsScreen({ lang, data }: { lang: "en" | "zh"; data: DocsLoaderData }) {
  return (
    <DocsLayout {...baseOptions(lang)} tree={data.pageTree}>
      <Suspense>
        <DocsArticle path={data.path} />
      </Suspense>
    </DocsLayout>
  );
}
