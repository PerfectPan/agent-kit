import { createFileRoute, notFound, useParams } from "@tanstack/react-router";

import { DocsScreen } from "../../components/docs-screen.tsx";
import { slugsFromSplat } from "../../lib/docs-path.ts";
import { source } from "../../lib/source.ts";

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
