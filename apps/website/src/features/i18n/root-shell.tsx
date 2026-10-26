import { LanguageProvider, useLanguageState } from "../../hooks/use-language.ts";
import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import { DOCS_PENDING_CLASS, DOCS_PENDING_TIMEOUT_MS, LANG_STORAGE_KEY, languageFrom } from "./lang-preference.ts";
import { translations } from "./translations.ts";
import { PreviewNotice } from "../preview/index.ts";

export function RootShell() {
  const { lang, setLang } = useLanguageState({
    resolve: languageFrom,
    storageKey: LANG_STORAGE_KEY,
    pendingClass: DOCS_PENDING_CLASS,
    pendingTimeout: DOCS_PENDING_TIMEOUT_MS
  });

  function onLocaleChange(value: string) {
    if (value === "en" || value === "zh") {
      setLang(value);
    }
  }

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewNotice />
        <LanguageProvider value={{ lang, setLang }}>
          <RootProvider
            theme={{ defaultTheme: "light" }}
            i18n={{ ...i18nProvider(translations, lang), onLocaleChange }}
            search={{
              options: {
                type: "static",
                api: `${import.meta.env.BASE_URL}api/search.${lang}.json`
              }
            }}
          >
            <Outlet />
          </RootProvider>
        </LanguageProvider>
        <Scripts />
      </body>
    </html>
  );
}
