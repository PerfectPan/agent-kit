import { expect, it } from "vite-plus/test";

import { LANG_STORAGE_KEY, landingRedirect, landingRedirectScript } from "./lang-preference.ts";

it("sends a first visit that prefers Chinese to /zh", () => {
  expect(landingRedirect(null, "zh-CN")).toBe("/zh");
  expect(landingRedirect(null, "zh")).toBe("/zh");
  expect(landingRedirect(null, "en-US")).toBeNull();
});

it("remembers an explicit language choice", () => {
  expect(landingRedirect("en", "zh-CN")).toBeNull();
  expect(landingRedirect("zh", "en-US")).toBe("/zh");
});

it("embeds the same choice in the static-page script", () => {
  const script = landingRedirectScript();
  expect(script).toContain(JSON.stringify(LANG_STORAGE_KEY));
  expect(script).toContain('stored==="zh"');
  expect(script).toContain('stored!=="en"');
  expect(script).toContain('indexOf("zh")===0');
  expect(script).toContain('"/agent-kit/zh"');
});
