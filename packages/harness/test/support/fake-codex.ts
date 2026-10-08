/**
 * A stand-in for `codex plugin` that does what Codex does on disk: `plugin marketplace add <dir>` records
 * `[marketplaces.<name>]` in `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`), `plugin add <name>@<marketplace>`
 * copies the plugin from that marketplace into `plugins/cache/<marketplace>/<name>/local/` and records
 * `[plugins."<name>@<marketplace>"]`, and the `remove` commands undo that. Every call is appended to `codex-calls.log`
 * in the home.
 */
export const FAKE_CODEX = String.raw`
const { appendFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, basename } = require("node:path");
const home = process.env.HOME;
const dir = process.env.CODEX_HOME || join(home, ".codex");
const config = join(dir, "config.toml");
appendFileSync(join(home, "codex-calls.log"), process.argv.slice(2).join(" ") + "\n");
mkdirSync(dir, { recursive: true });
const text = existsSync(config) ? readFileSync(config, "utf8") : "";
const without = (header) => {
  const lines = text.split("\n");
  const start = lines.indexOf(header);
  if (start < 0) return text;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("[")) end++;
  lines.splice(start, end - start);
  return lines.join("\n");
};
const [plugin, verb, a, b] = process.argv.slice(2);
if (plugin !== "plugin") process.exit(2);
if (verb === "marketplace" && a === "add") {
  writeFileSync(config, text + "\n[marketplaces." + basename(b) + "]\nsource_type = \"local\"\nsource = \"" + b + "\"\n");
} else if (verb === "marketplace" && a === "remove") {
  writeFileSync(config, without("[marketplaces." + b + "]"));
} else if (verb === "add") {
  const [name, market] = a.split("@");
  const source = /source = "([^"]*)"/.exec(text.slice(text.indexOf("[marketplaces." + market + "]")))[1];
  cpSync(join(source, "plugins", name), join(dir, "plugins", "cache", market, name, "local"), { recursive: true });
  writeFileSync(config, text + "\n[plugins.\"" + a + "\"]\nenabled = true\n");
} else if (verb === "remove") {
  const [name, market] = a.split("@");
  rmSync(join(dir, "plugins", "cache", market, name), { recursive: true, force: true });
  writeFileSync(config, without("[plugins.\"" + a + "\"]"));
} else {
  process.exit(2);
}
`;
