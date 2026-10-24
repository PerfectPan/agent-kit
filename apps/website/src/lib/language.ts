import { SITE_BASE_PATH } from "./site.ts";

/** Locale from the pathname. The router may or may not include the GitHub Pages base path. */
export function languageOf(pathname: string): "en" | "zh" {
  const bare =
    pathname === SITE_BASE_PATH || pathname.startsWith(`${SITE_BASE_PATH}/`)
      ? pathname.slice(SITE_BASE_PATH.length) || "/"
      : pathname;
  if (bare === "/zh" || bare.startsWith("/zh/")) {
    return "zh";
  }
  return "en";
}
