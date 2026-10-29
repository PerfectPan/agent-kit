/** Frontmatter descriptions render as plain text, so a code mark would show as a character. */
export function plainDescription(description: string): string {
  return description.replaceAll("`", "");
}

export function withFrontmatter(body: string, title: string, description: string): string {
  return `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(plainDescription(description))}\n---\n\n${body.trimStart()}`;
}

/** Drop a leading YAML block so the page gets one frontmatter, written by us. */
export function stripFrontmatter(body: string): string {
  if (!body.startsWith("---\n")) {
    return body;
  }
  const end = body.indexOf("\n---", 4);
  if (end === -1) {
    return body;
  }
  return body.slice(end + 4).replace(/^\n+/, "");
}

/** TypeDoc's module links point at `.mdx` files. Docs routes do not. */
export function rewriteApiLinks(markdown: string): string {
  return markdown.replaceAll(/\]\(([^)\s]+)\.mdx(#[^)]+)?\)/g, (_full, href: string, hash?: string) => {
    const slug = href.replace(/^\.\//, "").replaceAll("/", "-");
    return `](/docs/api/${slug}${hash ?? ""})`;
  });
}

export interface IndexEntry {
  readonly specifier: string;
  readonly slug: string;
  readonly blurb: string;
}

export interface IndexGroup {
  readonly packageName: string;
  readonly entries: readonly IndexEntry[];
}

/** Index first, then one separator and the entry slugs of each package, in export order. */
export function apiMetaPages(groups: readonly IndexGroup[]): string[] {
  const pages = ["index"];
  for (const group of groups) {
    pages.push(`---${group.packageName}---`, ...group.entries.map((entry) => entry.slug));
  }
  return pages;
}

export function apiIndexBody(groups: readonly IndexGroup[]): string {
  const lines = [
    "Each page lists the functions, types, interfaces and constants of one published entry. The text is generated from the built declarations.",
    ""
  ];
  for (const group of groups) {
    lines.push(`## ${group.packageName}`, "");
    for (const entry of group.entries) {
      lines.push(`- [\`${entry.specifier}\`](/docs/api/${entry.slug}) — ${entry.blurb}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
