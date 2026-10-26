import { createContext, use, useCallback, useLayoutEffect, useState } from "react";

import type { Lang } from "../lib/language.ts";

interface LanguageValue {
  readonly lang: Lang;
  readonly setLang: (next: Lang) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);
export const LanguageProvider = LanguageContext.Provider;

export function useLanguage(): LanguageValue {
  const value = use(LanguageContext);
  if (value === null) {
    throw new Error("useLanguage requires RootShell");
  }
  return value;
}

export function useLanguageState({
  resolve,
  storageKey,
  pendingClass,
  pendingTimeout
}: {
  readonly resolve: (stored: string | null, navigatorLanguage: string) => Lang;
  readonly storageKey: string;
  readonly pendingClass: string;
  readonly pendingTimeout: number;
}): LanguageValue {
  const [lang, setLangState] = useState<Lang>("en");

  useLayoutEffect(() => {
    const resolved = resolve(localStorage.getItem(storageKey), navigator.language || "");
    document.documentElement.lang = resolved;
    if (resolved === "en") {
      document.documentElement.classList.remove(pendingClass);
    }
    setLangState(resolved);
    const timeout = window.setTimeout(() => document.documentElement.classList.remove(pendingClass), pendingTimeout);
    return () => window.clearTimeout(timeout);
  }, [resolve, storageKey, pendingClass, pendingTimeout]);

  const setLang = useCallback(
    (next: Lang) => {
      const x = window.scrollX;
      const y = window.scrollY;
      localStorage.setItem(storageKey, next);
      document.documentElement.lang = next;
      document.documentElement.classList.remove(pendingClass);
      setLangState(next);
      requestAnimationFrame(() => {
        window.scrollTo(x, y);
      });
    },
    [storageKey, pendingClass]
  );

  return { lang, setLang };
}
