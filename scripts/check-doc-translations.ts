import { runDocTranslations } from "@perfectpan/lint-config/doc-translations";

process.exitCode = runDocTranslations(
  {
    sources: ["apps/website/content/docs/en/**/*.mdx"],
    translations: ["apps/website/content/docs/zh/**/*.mdx"],
    exclude: ["apps/website/content/docs/en/api/**"],
    translationOf: (path) => path.replace("/docs/en/", "/docs/zh/")
  },
  process.argv.slice(2)
);
