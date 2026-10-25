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

export function docsIndex(): "/docs" {
  return "/docs";
}

export function entryGuide(entry: string): { to: "/docs/$"; params: { _splat: string } } {
  if (!(entry in ENTRY_GUIDE_SLUG)) {
    throw new Error(`No guide for ${entry}`);
  }
  const slug = ENTRY_GUIDE_SLUG[entry as GuideEntry];
  return {
    to: "/docs/$",
    params: { _splat: slug }
  };
}

export function guide(slug: string): { to: "/docs/$"; params: { _splat: string } } {
  return {
    to: "/docs/$",
    params: { _splat: slug }
  };
}
