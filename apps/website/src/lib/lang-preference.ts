import type { Lang } from "./landing-copy.ts";

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

export function clearDocsPending(): void {
  document.documentElement.classList.remove(DOCS_PENDING_CLASS);
}

/**
 * Runs in `<head>` before first paint. Sets `<html lang>` from the stored choice or
 * `navigator.language`. Chinese visitors also get `ak-docs-pending` so the English
 * prerendered docs shell stays hidden until the Chinese body is ready.
 */
export function languageBootScript(): string {
  return `try{var stored=localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});var language=navigator.language||"";var lang=stored==="en"||stored==="zh"?stored:language.toLowerCase().indexOf("zh")===0?"zh":"en";document.documentElement.lang=lang;if(lang==="zh")document.documentElement.classList.add(${JSON.stringify(DOCS_PENDING_CLASS)});}catch(e){}`;
}
