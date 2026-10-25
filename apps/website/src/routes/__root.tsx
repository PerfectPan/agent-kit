import { createRootRoute } from "@tanstack/react-router";

import { RootShell } from "../components/root-shell.tsx";
import { languageBootScript } from "../lib/lang-preference.ts";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  beforeLoad: async () => {
    if (!import.meta.env.SSR) {
      return;
    }
    const { writeSearchIndexes } = await import("../lib/write-search-index.ts");
    await writeSearchIndexes();
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "agent-kit" }
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [{ children: languageBootScript() }]
  }),
  component: RootShell
});
