// Copies the search database written during prerender into the static client output.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "dist/.search/search.json");
const targetDir = path.join(root, "dist/client/api");
const target = path.join(targetDir, "search.json");

if (!existsSync(source)) {
  throw new Error(`missing search index at ${source}`);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`search index ${target}`);
