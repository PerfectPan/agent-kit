import { createRootRoute } from "@tanstack/react-router";

import { RootShell } from "../features/i18n/root-shell.tsx";
import { languageBootScript } from "../features/i18n/language-boot-script.ts";
import appCss from "../components/app.css?url";
import { previewMeta } from "../features/preview/index.ts";

export const Route = createRootRoute({
  beforeLoad: async () => {
    if (!import.meta.env.SSR) {
      return;
    }
    const { writeSearchIndexes } = await import("../features/docs/write-search-index.ts");
    await writeSearchIndexes();
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "agent-kit" },
      ...previewMeta
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [{ children: languageBootScript() }]
  }),
  component: RootShell
});
