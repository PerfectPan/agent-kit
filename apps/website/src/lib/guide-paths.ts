import type { Lang } from "./landing-copy.ts";

/** Slug under `/docs` for each landing entry row. */
export const ENTRY_GUIDE_SLUG = {
  "/discovery": "connection/discovery",
  "/sessions": "connection/sessions",
  "/transcript": "connection/sessions",
  "/transcript/usage": "connection/token-usage",
  "/cost": "connection/cost",
  "/harness/events": "connection/hook-events",
  "/harness": "connection/harness",
  "/acp": "connection/acp",
  "/redact": "connection/redaction",
  "/process-lock": "coordination/process-locks",
  "/lease": "coordination/leases",
  "/lanes": "coordination/lanes"
} as const;

export type GuideEntry = keyof typeof ENTRY_GUIDE_SLUG;

export function docsIndex(lang: Lang): "/docs" | "/zh/docs" {
  return lang === "zh" ? "/zh/docs" : "/docs";
}

export function entryGuide(lang: Lang, entry: string): { to: "/docs/$" | "/zh/docs/$"; params: { _splat: string } } {
  if (!(entry in ENTRY_GUIDE_SLUG)) {
    throw new Error(`No guide for ${entry}`);
  }
  const slug = ENTRY_GUIDE_SLUG[entry as GuideEntry];
  return {
    to: lang === "zh" ? "/zh/docs/$" : "/docs/$",
    params: { _splat: slug }
  };
}

export function guide(lang: Lang, slug: string): { to: "/docs/$" | "/zh/docs/$"; params: { _splat: string } } {
  return {
    to: lang === "zh" ? "/zh/docs/$" : "/docs/$",
    params: { _splat: slug }
  };
}
