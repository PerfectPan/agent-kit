import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useFumadocsLoader } from "fumadocs-core/source/client";

import { DocsScreen } from "../../../components/docs-screen.tsx";
import { loadDocsPage } from "../../../lib/docs-loader.ts";
import { docs } from "../../../lib/source.ts";

function ChineseDocsPage() {
  const data = useFumadocsLoader(useLoaderData({ from: "/zh/docs/$" }));
  return <DocsScreen lang="zh" data={data} />;
}

export const Route = createFileRoute("/zh/docs/$")({
  component: ChineseDocsPage,
  loader: async ({ params }) => {
    const data = await loadDocsPage({
      data: { lang: "zh", slugs: (params._splat ?? "").split("/").filter((part) => part.length > 0) }
    });
    await docs.getPage(data.path)?.preload();
    return data;
  }
});
