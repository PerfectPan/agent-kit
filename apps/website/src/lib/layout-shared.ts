import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { uiTranslations } from "fumadocs-ui/i18n";

import { DocsBrand } from "../components/docs-brand.tsx";
import { docsUiZh } from "./docs-ui-zh.ts";
import { i18n } from "./i18n.ts";
import { GITHUB_URL } from "./projects.ts";

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: "English" },
    zh: { displayName: "中文", ...docsUiZh }
  });

export function baseOptions(locale: "en" | "zh"): BaseLayoutProps {
  return {
    githubUrl: GITHUB_URL,
    nav: {
      title: DocsBrand,
      url: locale === "zh" ? "/zh" : "/"
    }
  };
}
