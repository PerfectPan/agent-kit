// Copies the per-language search databases written during prerender into the static client output.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "dist/.search");
const targetDir = path.join(root, "dist/client/api");

mkdirSync(targetDir, { recursive: true });
for (const lang of ["en", "zh"]) {
  const source = path.join(sourceDir, `search.${lang}.json`);
  if (!existsSync(source)) {
    throw new Error(`missing search index at ${source}`);
  }
  const target = path.join(targetDir, `search.${lang}.json`);
  copyFileSync(source, target);
  console.log(`search index ${target}`);
}
