import { landingFactsPlugin } from "./src/features/docs/build/landing-facts-plugin.ts";
import { fileURLToPath } from "node:url";

import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

import { normalizeBasePath } from "./src/lib/site.ts";

const basePath = normalizeBasePath(process.env.SITE_BASE_PATH ?? "/agent-kit");
const previewPr = process.env.SITE_PREVIEW_PR ?? "";
if (previewPr && !/^[1-9][0-9]*$/.test(previewPr)) {
  throw new Error("SITE_PREVIEW_PR must be a positive integer");
}

export default defineConfig({
  base: `${basePath}/`,
  define: {
    "import.meta.env.SITE_PREVIEW_PR": JSON.stringify(previewPr)
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    landingFactsPlugin(),
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
        failOnError: true
      },
      pages: [{ path: "/" }, { path: "/docs" }],
      router: {
        basepath: basePath,
        quoteStyle: "double",
        semicolons: true
      }
    }),
    react()
  ],
  fmt: {
    ...fmt,
    ignorePatterns: ["src/routeTree.gen.ts", ".source/**", "content/docs/en/api/**", "content/docs/zh/api/**"]
  },
  lint: {
    ...lint,
    ignorePatterns: [
      "node_modules/**",
      "dist/**",
      "src/routeTree.gen.ts",
      ".source/**",
      "content/docs/en/api/**",
      "content/docs/zh/api/**"
    ]
  },
  test: {
    passWithNoTests: true
  }
});
