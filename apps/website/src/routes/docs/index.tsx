import { createFileRoute, notFound } from "@tanstack/react-router";

import { DocsScreen } from "../../components/docs-screen.tsx";
import { source } from "../../lib/source.ts";

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
