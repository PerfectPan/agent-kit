import { createFileRoute, notFound, useParams } from "@tanstack/react-router";

import { DocsScreen } from "../../features/docs/docs-page.tsx";
import { slugsFromSplat } from "../../features/docs/docs-path.ts";
import { source } from "../../features/docs/source.ts";

function DocsPage() {
  const { _splat } = useParams({ from: "/docs/$" });
  return <DocsScreen splat={_splat} />;
}

export const Route = createFileRoute("/docs/$")({
  component: DocsPage,
  loader: ({ params }) => {
    if (!source.getPage(slugsFromSplat(params._splat), "en")) {
      throw notFound();
    }
  }
});
