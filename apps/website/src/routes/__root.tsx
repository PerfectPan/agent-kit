import { createRootRoute, HeadContent, Outlet, Scripts, useRouterState } from "@tanstack/react-router";
import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { languageOf } from "../lib/language.ts";
import { translations } from "../lib/layout-shared.ts";
import appCss from "../styles/app.css?url";

function RootComponent() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const language = languageOf(pathname);

  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <RootProvider
          theme={{ defaultTheme: "light" }}
          i18n={i18nProvider(translations, language)}
          search={{
            options: {
              type: "static",
              api: `${import.meta.env.BASE_URL}api/search.json`
            }
          }}
        >
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "agent-kit" }
    ],
    links: [{ rel: "stylesheet", href: appCss }]
  }),
  component: RootComponent
});
