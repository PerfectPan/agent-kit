import { uiTranslations } from "fumadocs-ui/i18n";
import { docsUiZh } from "./docs-ui-zh.ts";
import { i18n } from "./i18n.ts";

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: { displayName: "English" },
    zh: { displayName: "中文", ...docsUiZh }
  });
