import { expect, it } from "vite-plus/test";
import { runInNewContext } from "node:vm";

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

it.each(["/agent-kit/docs", "/agent-kit/pr-preview/pr-215/docs"])(
  "restores the language before paint at %s without rewriting the URL",
  (pathname) => {
    const classes = new Set<string>();
    const documentElement = { lang: "en", classList: { add: (value: string) => classes.add(value) } };
    const location = { pathname };
    runInNewContext(languageBootScript(), {
      document: { documentElement },
      localStorage: { getItem: () => "zh" },
      navigator: { language: "en" },
      location
    });
    expect(documentElement.lang).toBe("zh");
    expect(classes.has(DOCS_PENDING_CLASS)).toBe(true);
    expect(location.pathname).toBe(pathname);
  }
);
