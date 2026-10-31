import { createRootRoute } from "@tanstack/react-router";

import { RootShell } from "../features/i18n/root-shell.tsx";
import { languageBootScript } from "../features/i18n/language-boot-script.ts";
import appCss from "../components/app.css?url";
import favicon from "../assets/favicon.svg?url";

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
      { title: "agent-kit" }
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: favicon }
    ],
    scripts: [{ children: languageBootScript() }]
  }),
  component: RootShell
});
