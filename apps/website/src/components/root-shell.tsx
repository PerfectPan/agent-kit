import { HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { createContext, use, useCallback, useLayoutEffect, useState } from "react";
import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import type { Lang } from "../lib/landing-copy.ts";
import { clearDocsPending, DOCS_PENDING_TIMEOUT_MS, LANG_STORAGE_KEY, languageFrom } from "../lib/lang-preference.ts";
import { translations } from "../lib/layout-shared.ts";

interface LanguageValue {
  readonly lang: Lang;
  readonly setLang: (next: Lang) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

export function useLanguage(): LanguageValue {
  const value = use(LanguageContext);
  if (value === null) {
    throw new Error("useLanguage requires RootShell");
  }
  return value;
}

export function RootShell() {
  const [lang, setLangState] = useState<Lang>("en");

  useLayoutEffect(() => {
    const resolved = languageFrom(localStorage.getItem(LANG_STORAGE_KEY), navigator.language || "");
    document.documentElement.lang = resolved;
    if (resolved === "en") {
      clearDocsPending();
    }
    setLangState(resolved);
    const timeout = window.setTimeout(clearDocsPending, DOCS_PENDING_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  const setLang = useCallback((next: Lang) => {
    const x = window.scrollX;
    const y = window.scrollY;
    localStorage.setItem(LANG_STORAGE_KEY, next);
    document.documentElement.lang = next;
    clearDocsPending();
    setLangState(next);
    requestAnimationFrame(() => {
      window.scrollTo(x, y);
    });
  }, []);

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
        <LanguageContext value={{ lang, setLang }}>
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
        </LanguageContext>
        <Scripts />
      </body>
    </html>
  );
}
