import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";

import { englishFallback } from "./docs-fallback.ts";
import { i18n } from "./i18n.ts";
import { source } from "./source.ts";

export interface DocsPageInput {
  lang: "en" | "zh";
  slugs: readonly string[];
}

function parseDocsInput(input: unknown): DocsPageInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("docs page input must be an object");
  }
  const lang = "lang" in input ? input.lang : undefined;
  const slugs = "slugs" in input ? input.slugs : undefined;
  if (lang !== "en" && lang !== "zh") {
    throw new Error("docs page lang must be en or zh");
  }
  if (!Array.isArray(slugs) || slugs.some((slug) => typeof slug !== "string" || slug.length === 0)) {
    throw new Error("docs page slugs must be non-empty strings");
  }
  return { lang, slugs };
}

export const loadDocsPage = createServerFn({ method: "GET" })
  .middleware([staticFunctionMiddleware])
  .validator(parseDocsInput)
  .handler(async ({ data }) => {
    const lang = data.lang === "zh" ? "zh" : i18n.defaultLanguage;
    const page = source.getPage([...data.slugs], lang);
    if (!page) {
      throw notFound();
    }
    if (import.meta.env.SSR) {
      const { writeSearchIndexOnce } = await import("./write-search-index.ts");
      await writeSearchIndexOnce();
    }

    return {
      path: page.path,
      fallback: englishFallback(lang, page.path),
      pageTree: await source.serializePageTree(source.getPageTree(lang))
    };
  });
