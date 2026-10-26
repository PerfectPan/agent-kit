import { expect, it } from "vite-plus/test";

import { languageBootScript } from "./language-boot-script.ts";
import { DOCS_PENDING_CLASS, LANG_STORAGE_KEY } from "./lang-preference.ts";

it("embeds the same choice in the static-page script", () => {
  const script = languageBootScript();
  expect(script).toContain(JSON.stringify(LANG_STORAGE_KEY));
  expect(script).toContain(JSON.stringify(DOCS_PENDING_CLASS));
  expect(script).toContain('stored==="en"||stored==="zh"');
  expect(script).toContain('indexOf("zh")===0');
  expect(script).toContain("document.documentElement.lang=lang");
  expect(script).not.toContain("/zh");
});
