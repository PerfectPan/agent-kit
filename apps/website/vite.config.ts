import { landingFactsPlugin } from "./src/features/landing/facts-plugin.ts";
import { fileURLToPath } from "node:url";

import { fmt, lint } from "@perfectpan/lint-config/vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";
import type { OxlintOverride } from "vite-plus/lint";

import { normalizeBasePath } from "./src/lib/site.ts";

const basePath = normalizeBasePath(process.env.SITE_BASE_PATH ?? "/agent-kit");

// eslint-plugin-better-tailwindcss reads the classes in className, cn(), cva() and clsx() against a stylesheet. The
// landing folders compile against landing.css, which defines the phone, narrow and zh variants; the docs and shared
// UI compile against app.css, which carries the Fumadocs colours.
const landingSources = [
  "src/components/landing/**",
  "src/components/mascot.tsx",
  "src/features/landing/**",
  "src/features/demo/**",
  "src/features/layer/**"
];
function tailwindRules(stylesheet: string): NonNullable<OxlintOverride["rules"]> {
  const entryPoint = fileURLToPath(new URL(`./src/components/${stylesheet}`, import.meta.url));
  return {
    // `landing-langs` is a hook for a landing.css selector, not a utility.
    "better-tailwindcss/no-unknown-classes": ["error", { entryPoint, ignore: ["^landing-langs$"] }],
    "better-tailwindcss/no-conflicting-classes": ["error", { entryPoint }],
    "better-tailwindcss/no-duplicate-classes": ["error", { entryPoint }],
    "better-tailwindcss/no-unnecessary-whitespace": ["error", { entryPoint }],
    "better-tailwindcss/enforce-canonical-classes": ["error", { entryPoint }]
  };
}

export default defineConfig({
  base: `${basePath}/`,
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
    jsPlugins: [{ name: "better-tailwindcss", specifier: "eslint-plugin-better-tailwindcss" }],
    overrides: [
      ...lint.overrides,
      { files: ["src/**/*.{ts,tsx}"], excludeFiles: landingSources, rules: tailwindRules("app.css") },
      { files: landingSources, rules: tailwindRules("landing.css") },
      // shadcn/ui keeps a component and its parts (ToggleGroup and ToggleGroupItem, Tabs and its list, triggers and
      // panel) in one file.
      { files: ["src/components/ui/*.tsx"], plugins: ["react"], rules: { "react/no-multi-comp": "off" } }
    ],
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
