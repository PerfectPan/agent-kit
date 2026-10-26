import { createFileRoute, notFound } from "@tanstack/react-router";

import { DocsScreen } from "../../features/docs/docs-page.tsx";
import { source } from "../../features/docs/source.ts";

function DocsIndex() {
  return <DocsScreen />;
}

export const Route = createFileRoute("/docs/")({
  component: DocsIndex,
  loader: () => {
    if (!source.getPage([], "en")) {
      throw notFound();
    }
  }
});
