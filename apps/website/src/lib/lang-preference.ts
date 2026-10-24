import { SITE_BASE_PATH } from "./site.ts";

/** Same key the approved mockup used. The header switch writes it; the English page reads it. */
export const LANG_STORAGE_KEY = "ak-lang";

/**
 * Client redirect for the English landing URL.
 * A stored choice wins. With no choice, a browser that prefers Chinese goes to `/zh`.
 * Returns the path to open, or null to stay on `/`.
 */
export function landingRedirect(stored: string | null, language: string): "/zh" | null {
  if (stored === "en") {
    return null;
  }
  if (stored === "zh" || language.toLowerCase().startsWith("zh")) {
    return "/zh";
  }
  return null;
}

/** Inline script for the prerendered English page. Static hosting has no server redirect. */
export function landingRedirectScript(): string {
  const target = `${SITE_BASE_PATH}/zh`;
  return `try{var stored=localStorage.getItem(${JSON.stringify(LANG_STORAGE_KEY)});var language=navigator.language||"";if(stored==="zh"||(stored!=="en"&&language.toLowerCase().indexOf("zh")===0)){location.replace(${JSON.stringify(target)}+location.search+location.hash);}}catch(e){}`;
}
