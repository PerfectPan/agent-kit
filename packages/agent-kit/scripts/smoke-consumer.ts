import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Packs the shell, installs the tarball into a throwaway consumer project the way a user would, and checks it from
// there: the tarball holds only what it should, every entry type-checks under node16 and bundler resolution, and
// every entry loads in Node and reads sessions from a temporary home. The real home directory is never read.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const fixtures = join(repoRoot, "packages/testing/test/fixtures");
const tsc = join(packageRoot, "node_modules/.bin/tsc");
const nodeTypes = join(packageRoot, "node_modules/@types");

/**
 * One seeded session per built-in session adapter: a fixture under `packages/testing/test/fixtures` and where the
 * agent keeps it under its home. The consumer fails when `builtinSessionAdapters` has an agent this list lacks, so a
 * new adapter (Grok next) adds its row here.
 */
const SEEDS: readonly { agent: string; fixture: string; target: string }[] = [
  { agent: "claude-code", fixture: "claude-code/conformance/subagent", target: ".claude/projects/smoke" },
  {
    agent: "codex",
    fixture: "codex/conformance/rollout-plain.jsonl",
    target: ".codex/sessions/2026/01/01/rollout-plain.jsonl"
  }
];

const ROOT_FILES = new Set(["package.json", "README.md", "LICENSE"]);

interface Manifest {
  name: string;
  exports: Record<string, unknown>;
}

interface PackResult {
  filename: string;
  files: { path: string }[];
}

// npm reads npm_config_* variables before its config files; the ones Rush and pnpm export must not steer it.
const npmEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_/i.test(key)));

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}\n${stdout}${stderr}`, { cause: error });
  }
}

function tarballProblems(files: readonly string[], installed: string): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (!ROOT_FILES.has(file) && !file.startsWith("dist/")) {
      problems.push(`tarball contains ${file}, outside dist/ and ${[...ROOT_FILES].join(", ")}`);
    }
    if (/\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file)) {
      problems.push(`tarball contains TypeScript source ${file}`);
    }
    const content = readFileSync(join(installed, file), "utf8");
    if (content.includes(repoRoot)) {
      problems.push(`${file} contains the absolute repository path`);
    }
    if (file.endsWith(".map")) {
      const { sources = [] } = JSON.parse(content) as { sources?: string[] };
      for (const source of sources) {
        if (isAbsolute(source) || /^(file:|[A-Za-z]:[\\/])/.test(source) || source.includes("/Users/")) {
          problems.push(`${file} points at the absolute source path ${source}`);
        }
      }
    }
  }
  return problems;
}

/** A consumer module that imports every entry, then lists and reads the seeded sessions through the Node platform. */
function consumerSource(manifest: Manifest, home: string): string {
  const subpaths = Object.keys(manifest.exports).filter((subpath) => subpath !== "./package.json");
  const namespaces = subpaths.map(
    (subpath, index) => `import * as entry${index} from "${manifest.name}/${subpath.slice(2)}";`
  );
  const entries = subpaths.map((subpath, index) => `  ${JSON.stringify(subpath)}: entry${index},`);
  return `import assert from "node:assert/strict";

${namespaces.join("\n")}
import { createNodePlatform } from "${manifest.name}/node";
import type { Platform } from "${manifest.name}/platform";
import { builtinSessionAdapters, isSessionHead, listSessions, type SessionHead } from "${manifest.name}/sessions";
import { loadTranscript } from "${manifest.name}/transcript";

const entries: Record<string, object> = {
${entries.join("\n")}
};
for (const [subpath, namespace] of Object.entries(entries)) {
  assert.ok(Object.keys(namespace).length > 0, \`\${subpath} exports nothing at runtime\`);
}

const seeded: readonly string[] = ${JSON.stringify(SEEDS.map((seed) => seed.agent))};
assert.deepEqual(
  Object.keys(builtinSessionAdapters).toSorted(),
  seeded.toSorted(),
  "every built-in session adapter needs a row in SEEDS of smoke-consumer.ts"
);

// An empty env keeps the caller's CLAUDE_CONFIG_DIR, CODEX_HOME and the like from pointing at real agent homes.
const platform: Platform = createNodePlatform({ home: ${JSON.stringify(home)}, env: {} });
for (const agent of seeded) {
  const heads: SessionHead[] = [];
  for await (const item of listSessions(platform, { agents: [agent] })) {
    if (isSessionHead(item)) {
      heads.push(item);
    } else {
      assert.equal(item.error._tag, "RootMissing", \`\${agent}: cannot list \${item.ref.path}\`);
    }
  }
  assert.equal(heads.length, 1, \`\${agent}: expected the seeded session, listed \${heads.length}\`);
  const [head] = heads;
  assert.ok(head);
  const transcript = await loadTranscript(platform, head.ref);
  if (!transcript.ok) {
    assert.fail(\`\${agent}: loadTranscript failed with \${transcript.error._tag}\`);
  }
  assert.ok(transcript.value.events.length > 0, \`\${agent}: the transcript has no events\`);
  console.log(\`\${agent}: \${transcript.value.events.length} events\`);
}
`;
}

function tsconfig(module: string, moduleResolution: string): string {
  const compilerOptions = {
    module,
    moduleResolution,
    target: "ES2024",
    lib: ["ES2024"],
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    // The published declarations are part of what is checked.
    skipLibCheck: false,
    typeRoots: [nodeTypes],
    types: ["node"]
  };
  return `${JSON.stringify({ compilerOptions, files: ["consumer.ts"] }, null, 2)}\n`;
}

const started = performance.now();
const work = mkdtempSync(join(tmpdir(), "agent-kit-smoke-"));
try {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Manifest;
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], packageRoot, npmEnv)) as [
    PackResult
  ];

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  run(
    "npm",
    [
      "install",
      join(work, packed.filename),
      "--registry",
      "https://registry.npmjs.org/",
      "--no-audit",
      "--no-fund",
      "--loglevel",
      "error"
    ],
    consumer,
    npmEnv
  );

  const problems = tarballProblems(
    packed.files.map((file) => file.path),
    join(consumer, "node_modules", manifest.name)
  );
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }

  const home = join(work, "home");
  for (const seed of SEEDS) {
    mkdirSync(dirname(join(home, seed.target)), { recursive: true });
    cpSync(join(fixtures, seed.fixture), join(home, seed.target), { recursive: true });
  }

  writeFileSync(join(consumer, "consumer.ts"), consumerSource(manifest, home));
  for (const [name, module, moduleResolution] of [
    ["node16", "node16", "node16"],
    ["bundler", "preserve", "bundler"]
  ] as const) {
    writeFileSync(join(consumer, `tsconfig.${name}.json`), tsconfig(module, moduleResolution));
    run(tsc, ["-p", `tsconfig.${name}.json`], consumer);
  }
  const output = run(process.execPath, ["consumer.ts"], consumer).trim();

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`smoke-consumer: ok in ${seconds}s (${packed.files.length} files; ${output.split("\n").join(", ")})`);
} catch (error) {
  console.error(`smoke-consumer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
