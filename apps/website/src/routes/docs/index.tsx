import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useFumadocsLoader } from "fumadocs-core/source/client";

import { DocsScreen } from "../../components/docs-screen.tsx";
import { loadDocsPage } from "../../lib/docs-loader.ts";
import { docs } from "../../lib/source.ts";

function EnglishDocs() {
  const data = useFumadocsLoader(useLoaderData({ from: "/docs/" }));
  return <DocsScreen lang="en" data={data} />;
}

export const Route = createFileRoute("/docs/")({
  component: EnglishDocs,
  loader: async () => {
    const data = await loadDocsPage({ data: { lang: "en" } });
    await docs.getPage(data.path)?.preload();
    return data;
  }
});
