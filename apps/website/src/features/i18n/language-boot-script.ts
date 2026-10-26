import { LANG_STORAGE_KEY, DOCS_PENDING_CLASS } from "./lang-preference.ts";

/**
 * Runs in `<head>` before first paint. Sets `<html lang>` from the stored choice or
 * `navigator.language`. Chinese visitors also get `ak-docs-pending` so the English
 * prerendered docs shell stays hidden until the Chinese body is ready.
 */
export function languageBootScript(): string {
  return `try{var stored=localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});var language=navigator.language||"";var lang=stored==="en"||stored==="zh"?stored:language.toLowerCase().indexOf("zh")===0?"zh":"en";document.documentElement.lang=lang;if(lang==="zh")document.documentElement.classList.add(${JSON.stringify(DOCS_PENDING_CLASS)});}catch(e){}`;
}
