const PACKAGE_NAMES = ["@rivus/agent-kit-collab", "@rivus/agent-kit"] as const;

/** Sidebar label for an API page. The page title stays the full specifier. */
export function apiSidebarLabel(title: string): string | undefined {
  for (const packageName of PACKAGE_NAMES) {
    const prefix = `${packageName}/`;
    if (title.startsWith(prefix)) {
      return `/${title.slice(prefix.length)}`;
    }
  }
  return undefined;
}

function isApiDoc(pagePath: string): boolean {
  return pagePath.split("/").includes("api");
}

/** API pages list kind headings and symbol names. Member sections stay in the body. */
export function apiSymbolToc<T extends { readonly depth: number }>(pagePath: string, toc: readonly T[]): T[] {
  return isApiDoc(pagePath) ? toc.filter((item) => item.depth <= 3) : toc.slice();
}
