import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { uiTranslations } from "fumadocs-ui/i18n";

import { i18n } from "./i18n.ts";

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: "English" },
    zh: { displayName: "中文" }
  });

export function baseOptions(locale: "en" | "zh"): BaseLayoutProps {
  return {
    nav: {
      title: locale === "zh" ? "agent-kit 中文" : "agent-kit"
    }
  };
}
