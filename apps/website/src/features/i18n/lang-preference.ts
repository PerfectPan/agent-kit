import type { Lang } from "../../lib/language.ts";

/** Same key the header switch writes. The head script and React both read it. */
export const LANG_STORAGE_KEY = "ak-lang";

/** Set on `<html>` before paint when the visitor prefers Chinese, so docs stay hidden until the zh body loads. */
export const DOCS_PENDING_CLASS = "ak-docs-pending";

/** Reveal English docs if the Chinese body has not loaded by then. */
export const DOCS_PENDING_TIMEOUT_MS = 800;

export function languageFrom(stored: string | null, navigatorLanguage: string): Lang {
  if (stored === "en" || stored === "zh") {
    return stored;
  }
  if (navigatorLanguage.toLowerCase().startsWith("zh")) {
    return "zh";
  }
  return "en";
}
