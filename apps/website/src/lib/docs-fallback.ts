/** A Chinese URL whose file still lives under `content/docs/en`. */
export function englishFallback(lang: "en" | "zh", pagePath: string): boolean {
  return lang === "zh" && !pagePath.startsWith("zh/");
}
