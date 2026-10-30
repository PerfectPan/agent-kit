import { readFileSync } from "node:fs";

import { expect, it } from "vite-plus/test";

import { cn } from "./utils.ts";

it("keeps a theme text size next to a text colour", () => {
  expect(cn("text-ui text-ink", "text-body-sm")).toBe("text-ink text-body-sm");
  expect(cn("shadow-card", "shadow-window")).toBe("shadow-window");
  expect(cn("rounded-control", "rounded-md")).toBe("rounded-md");
});

// cn's tailwind-merge config lists theme.css's custom scales by hand; a token missing there would be merged as the
// wrong kind of class and silently dropped.
const theme = readFileSync(new URL("../components/theme.css", import.meta.url), "utf8");
function tokens(namespace: string): string[] {
  const names = [...theme.matchAll(new RegExp(`--${namespace}-([a-z0-9-]+?):`, "g"))].map((match) => match[1]!);
  return [...new Set(names.filter((name) => !name.includes("--")))];
}

it.each(tokens("text"))("merges text-%s as a font size", (name) => {
  expect(cn(`text-${name}`, "text-ink")).toBe(`text-${name} text-ink`);
  expect(cn("text-sm", `text-${name}`)).toBe(`text-${name}`);
});

it.each([
  ["shadow", "shadow-sm", "shadow"],
  ["radius", "rounded-md", "rounded"],
  ["ease", "ease-in", "ease"],
  ["animate", "animate-spin", "animate"],
  ["container", "max-w-md", "max-w"]
] as const)("merges every --%s token over a default of the same kind", (namespace, fallback, prefix) => {
  for (const name of tokens(namespace)) {
    expect(cn(fallback, `${prefix}-${name}`)).toBe(`${prefix}-${name}`);
  }
});
