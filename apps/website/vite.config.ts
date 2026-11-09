import { landingFactsPlugin } from "./src/features/landing/facts-plugin.ts";
import { fileURLToPath } from "node:url";

import { defineLint, fmt } from "@perfectpan/lint-config/vite-plus";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite-plus";

import { normalizeBasePath } from "./src/lib/site.ts";

const basePath = normalizeBasePath(process.env.SITE_BASE_PATH ?? "/agent-kit");

// better-tailwindcss reads the classes in className, cn(), cva() and clsx() against a stylesheet. The landing folders
// compile against landing.css, which defines the phone, narrow and zh variants; the docs and shared UI compile against
// app.css, which carries the Fumadocs colours.
const landingSources = [
  "src/components/landing/**",
  "src/components/mascot.tsx",
  "src/features/landing/**",
  "src/features/demo/**",
  "src/features/layer/**"
];
const stylesheet = (name: string) => fileURLToPath(new URL(`./src/components/${name}`, import.meta.url));

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
  lint: defineLint({
    tailwind: {
      stylesheets: [
        { entryPoint: stylesheet("app.css"), files: ["src/**/*.{ts,tsx}"], excludeFiles: landingSources },
        { entryPoint: stylesheet("landing.css"), files: landingSources }
      ],
      // The 43 literal colours and lengths wait for theme tokens; see lint-config#6.
      literalValues: false
    },
    // The shadcn/ui components keep a component and its parts (ToggleGroup and ToggleGroupItem, Tabs and its list,
    // triggers and panel) in one file, and render <button> only through Button.
    shadcn: { ui: ["src/components/ui/*.tsx"], elements: ["button"] },
    overrides: [
      // 2026-11-07: the layer-diagram chips and the copy button stay raw <button> on purpose. They draw their idle,
      // on-path and unsupported-dashed states with the bespoke layerChip cva and carry the data-node hooks the SVG
      // connectors select on; the shadcn Button variants would add hover lift, shadow and border classes the diagram
      // does not have. Turn off only react/forbid-elements for these three files.
      {
        files: [
          "src/components/landing/chip-row.tsx",
          "src/components/landing/copy-button.tsx",
          "src/components/landing/layer-fn-group.tsx"
        ],
        plugins: ["react"],
        rules: { "react/forbid-elements": "off" }
      }
    ],
    ignorePatterns: [
      "node_modules/**",
      "dist/**",
      "src/routeTree.gen.ts",
      ".source/**",
      "content/docs/en/api/**",
      "content/docs/zh/api/**"
    ]
  }),
  test: {
    passWithNoTests: true
  }
});
