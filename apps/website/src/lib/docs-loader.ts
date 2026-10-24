import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { staticFunctionMiddleware } from "@tanstack/start-static-server-functions";

import { i18n } from "./i18n.ts";
import { source } from "./source.ts";

export const loadDocsPage = createServerFn({ method: "GET" })
  .middleware([staticFunctionMiddleware])
  .validator((input: { lang: "en" | "zh" }) => input)
  .handler(async ({ data }) => {
    const lang = data.lang === "zh" ? "zh" : i18n.defaultLanguage;
    const page = source.getPage([], lang);
    if (!page) {
      throw notFound();
    }

    return {
      path: page.path,
      pageTree: await source.serializePageTree(source.getPageTree(lang))
    };
  });
