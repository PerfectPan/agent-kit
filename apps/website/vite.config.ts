import { fileURLToPath } from "node:url";

import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

import { SITE_BASE_PATH } from "./src/lib/site.ts";

export default defineConfig({
  base: `${SITE_BASE_PATH}/`,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
        failOnError: true
      },
      pages: [{ path: "/" }, { path: "/zh" }, { path: "/docs" }, { path: "/zh/docs" }],
      router: {
        basepath: SITE_BASE_PATH,
        quoteStyle: "double",
        semicolons: true
      }
    }),
    react()
  ],
  fmt: {
    ...fmt,
    ignorePatterns: ["src/routeTree.gen.ts", ".source/**"]
  },
  lint: {
    ...lint,
    ignorePatterns: ["node_modules/**", "dist/**", "src/routeTree.gen.ts", ".source/**"]
  },
  test: {
    passWithNoTests: true
  }
});
