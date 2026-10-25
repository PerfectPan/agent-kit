import { defineConfig } from "fumadocs-mdx/config";

const scopes = {
  comment: ["comment", "punctuation.definition.comment", "string.comment"],
  string: ["string", "string.quoted", "punctuation.definition.string"],
  number: ["constant.numeric", "constant.language", "constant.other", "variable.other.constant"],
  keyword: ["keyword", "storage", "storage.type", "keyword.operator.new"],
  function: ["entity.name.function", "support.function", "entity.name.method"],
  type: ["entity.name.type", "support.type", "support.class"]
};

const light = {
  name: "agent-kit-light",
  type: "light" as const,
  colors: {
    "editor.background": "#f3ece3",
    "editor.foreground": "#2a211e"
  },
  settings: [
    { settings: { foreground: "#2a211e" } },
    { scope: scopes.comment, settings: { foreground: "#85776e" } },
    { scope: scopes.string, settings: { foreground: "#4d6b4e" } },
    { scope: scopes.number, settings: { foreground: "#b94f3c" } },
    { scope: scopes.keyword, settings: { foreground: "#8f3a2b" } },
    { scope: scopes.function, settings: { foreground: "#6b5348" } },
    { scope: scopes.type, settings: { foreground: "#5d514b" } }
  ]
};

const dark = {
  name: "agent-kit-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#2a211e",
    "editor.foreground": "#eadfd3"
  },
  settings: [
    { settings: { foreground: "#eadfd3" } },
    { scope: scopes.comment, settings: { foreground: "#9c8f86" } },
    { scope: scopes.string, settings: { foreground: "#b9d7b6" } },
    { scope: scopes.number, settings: { foreground: "#e8a995" } },
    { scope: scopes.keyword, settings: { foreground: "#f0c27a" } },
    { scope: scopes.function, settings: { foreground: "#eadfd3" } },
    { scope: scopes.type, settings: { foreground: "#d6c7b6" } }
  ]
};

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light,
        dark
      }
    }
  }
});
