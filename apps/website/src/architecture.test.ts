import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync, Visitor } from "vite/rolldown/utils";
import { expect, it } from "vite-plus/test";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const stateHooks = new Set([
  "useState",
  "useEffect",
  "useReducer",
  "useContext",
  "useLayoutEffect",
  "useInsertionEffect",
  "useSyncExternalStore",
  "useRef",
  "use"
]);

function violations(file: string, code: string): string[] {
  const messages = new Set<string>();
  const [layer, feature] = file.split("/");
  // Parse .ts as TSX too: JSX in a hook is a named boundary failure, not just a parse error.
  const parsed = parseSync(file.replace(/\.ts$/, ".tsx"), code);
  function fail(rule: string, detail: string) {
    messages.add(`${rule}: ${file}: ${detail}`);
  }
  for (const error of parsed.errors) {
    fail("source-syntax", error.message);
  }

  function checkImport(specifier: string) {
    const path = specifier.split("?")[0]!;
    const target = path.startsWith("@/")
      ? relative(sourceRoot, resolve(sourceRoot, path.slice(2)))
      : path.startsWith(".")
        ? relative(sourceRoot, resolve(sourceRoot, dirname(file), path))
        : path;
    const [targetLayer, targetFeature] = target.split("/");
    if (
      layer === "components" &&
      (["features", "hooks", "routes"].includes(targetLayer!) || path.startsWith("virtual:"))
    ) {
      fail("components-pure-ui", `forbidden import ${specifier}`);
    }
    if (layer === "hooks" && ["features", "components", "routes"].includes(targetLayer!)) {
      fail("hooks-independent", `forbidden import ${specifier}`);
    }
    if (layer === "lib" && targetLayer !== "lib") {
      fail("lib-independent", `forbidden import ${specifier}`);
    }
    if (layer === "features" && targetLayer === "routes") {
      fail("features-no-routes", `forbidden import ${specifier}`);
    }
    if (
      layer === "features" &&
      targetLayer === "features" &&
      feature !== targetFeature &&
      target !== `features/${targetFeature}/index.ts`
    ) {
      fail("feature-public-entry", `use features/${targetFeature}/index.ts instead of ${specifier}`);
    }
  }

  const visitor = new Visitor({
    ImportDeclaration(node) {
      checkImport(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (node.source) {
        checkImport(node.source.value);
      }
    },
    ExportAllDeclaration(node) {
      checkImport(node.source.value);
    },
    ImportExpression(node) {
      if (node.source.type === "Literal" && typeof node.source.value === "string") {
        checkImport(node.source.value);
      }
    },
    TSImportType(node) {
      checkImport(node.source.value);
    },
    TSExternalModuleReference(node) {
      checkImport(node.expression.value);
    },
    CallExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (arg?.type === "Literal" && typeof arg.value === "string") {
          checkImport(arg.value);
        }
      }
    },
    Identifier(node) {
      if (layer === "components" && stateHooks.has(node.name)) {
        fail("components-no-state", `forbidden React hook ${node.name}`);
      }
    },
    MemberExpression(node) {
      if (
        layer === "components" &&
        node.computed &&
        node.property.type === "Literal" &&
        typeof node.property.value === "string" &&
        stateHooks.has(node.property.value)
      ) {
        fail("components-no-state", `forbidden React hook ${node.property.value}`);
      }
    },
    JSXElement() {
      if (layer === "hooks") {
        fail("hooks-no-jsx", "JSX element");
      }
    },
    JSXFragment() {
      if (layer === "hooks") {
        fail("hooks-no-jsx", "JSX fragment");
      }
    }
  });
  visitor.visit(parsed.program);
  return [...messages];
}

it("enforces website source boundaries", () => {
  const files = readdirSync(sourceRoot, { recursive: true, encoding: "utf8" }).filter(
    (file) => /\.[cm]?[jt]sx?$/.test(file) && file !== "routeTree.gen.ts"
  );
  const failures = files.flatMap((file) => violations(file, readFileSync(resolve(sourceRoot, file), "utf8")));
  expect(failures).toEqual([]);
});

it.each([
  ["components/a.tsx", 'import { x } from "../features/demo/index.ts";', "components-pure-ui"],
  ["components/a.tsx", 'export { x } from "@/hooks/use-clipboard.ts";', "components-pure-ui"],
  ["components/a.tsx", 'void import("../routes/index.tsx");', "components-pure-ui"],
  ["components/a.tsx", 'import { landingFacts } from "virtual:landing-facts";', "components-pure-ui"],
  ["components/a.tsx", 'import { useState as state } from "react"; state(0);', "components-no-state"],
  ["components/a.tsx", "React.useEffect(() => {});", "components-no-state"],
  ["components/a.tsx", 'React["useReducer"](reducer, 0);', "components-no-state"],
  ["components/a.tsx", "useContext(context);", "components-no-state"],
  ["components/a.tsx", "useLayoutEffect(() => {});", "components-no-state"],
  ["hooks/a.ts", 'import type { X } from "../features/demo/index.ts";', "hooks-independent"],
  ["hooks/a.ts", 'export * from "../components/mascot.tsx";', "hooks-independent"],
  ["hooks/a.ts", 'const route = require("../routes/index.tsx");', "hooks-independent"],
  ["hooks/a.ts", 'type T = import("../components/mascot.tsx").T;', "hooks-independent"],
  ["hooks/a.ts", "const element = <div />;", "hooks-no-jsx"],
  ["hooks/a.tsx", "const element = <>hello</>;", "hooks-no-jsx"],
  ["lib/a.ts", 'import { useState } from "react";', "lib-independent"],
  ["lib/a.ts", 'import { x } from "../hooks/x.ts";', "lib-independent"],
  ["features/demo/a.ts", 'export * from "../../routes/index.tsx";', "features-no-routes"],
  ["features/demo/a.ts", 'import { text } from "../landing/copy.ts";', "feature-public-entry"],
  ["features/docs/a.ts", 'import { x } from "../landing/copy.ts";', "feature-public-entry"]
])("reports a named rule for %s: %s", (file, code, rule) => {
  expect(violations(file, code).some((message) => message.startsWith(`${rule}:`))).toBe(true);
});

it.each([
  ["components/a.tsx", 'import { useId } from "react"; import { x } from "../lib/site.ts";'],
  ["components/a.tsx", 'const text = "useState import from ../features/demo"; // useEffect()'],
  ["hooks/a.ts", 'import { useState } from "react"; const label = "<div/>";'],
  ["lib/a.ts", 'import { x } from "./site.ts";'],
  ["features/demo/a.ts", 'import { text } from "../landing/index.ts";'],
  ["features/demo/a.ts", 'import { x } from "./snippets.ts";']
])("allows %s: %s", (file, code) => {
  expect(violations(file, code)).toEqual([]);
});
