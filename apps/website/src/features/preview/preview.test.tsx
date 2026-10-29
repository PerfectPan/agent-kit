import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["", "215"])("renders preview metadata and notice only for a preview build (%s)", async (pr) => {
  vi.stubEnv("SITE_PREVIEW_PR", pr);
  const { previewMeta, PreviewNotice } = await import("./index.ts");
  expect(previewMeta).toEqual(pr ? [{ name: "robots", content: "noindex" }] : []);
  const html = renderToStaticMarkup(<PreviewNotice />);
  if (pr) {
    expect(html).toContain("Preview of #215");
  } else {
    expect(html).toBe("");
  }
});
