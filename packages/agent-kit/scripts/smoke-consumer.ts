import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Packs the shell, installs the tarball into a throwaway consumer project the way a user would, and checks it from
// there: the tarball holds only what it should, every entry type-checks under node16 and bundler resolution, every
// entry loads in Node and reads sessions from a temporary home, and the hook entry starts fast in a fresh process.
// That consumer does not install effect, so it loads only the plain entries. A second consumer installs effect itself
// and runs a program on the Effect entries with exactly one copy of effect in its tree. The real home directory is
// never read.

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
  },
  { agent: "grok", fixture: "grok/conformance/plain", target: ".grok/sessions/%2Fu%2Fme%2Fwork/smoke-session" }
];

const ROOT_FILES = new Set(["package.json", "README.md", "LICENSE"]);

/** The entries that import the optional `effect` peer, as in check-dist.ts; a stale list fails one of the consumers. */
const EFFECT_ENTRIES = new Set(["./node/effect", "./platform/effect"]);

interface Manifest {
  name: string;
  exports: Record<string, unknown>;
  peerDependencies: { effect: string };
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

/** A consumer module that imports every plain entry, then lists and reads the seeded sessions through Node. */
function consumerSource(manifest: Manifest, home: string): string {
  const subpaths = Object.keys(manifest.exports).filter(
    (subpath) => subpath !== "./package.json" && !EFFECT_ENTRIES.has(subpath)
  );
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

/**
 * A hook process loads `/harness/events` and reads one payload. A generous bound catches an accidental heavy import
 * (Effect alone adds tens of milliseconds) without failing on a slow CI machine.
 */
const HOOK_COLD_START_BOUND_MS = 100;
const HOOK_COLD_START_RUNS = 5;

function coldStartSource(manifest: Manifest): string {
  return `const started = performance.now();
const { readHookEvent } = await import("${manifest.name}/harness/events");
const event = readHookEvent("claude-code", { hook_event_name: "UserPromptSubmit", session_id: "s1" }, {});
const elapsed = performance.now() - started;
if (event.phase !== "start" || event.sessionId !== "s1") {
  throw new Error(\`unexpected event \${JSON.stringify(event)}\`);
}
console.log(elapsed.toFixed(2));
`;
}

/** The median time, over fresh Node processes, from before the import to after one readHookEvent call. */
function hookColdStartMs(consumer: string): number {
  const runs = Array.from({ length: HOOK_COLD_START_RUNS }, () =>
    Number(run(process.execPath, ["cold-start.mjs"], consumer).trim())
  ).toSorted((a, b) => a - b);
  return runs[Math.floor(runs.length / 2)] ?? Number.NaN;
}

/**
 * A host that installs effect itself: it imports every Effect entry, checks that each resolves the host's effect at
 * the peer version, and runs a program that reads PlatformService through NodePlatformLive under the temporary home.
 */
function effectConsumerSource(manifest: Manifest, home: string): string {
  const subpaths = [...EFFECT_ENTRIES];
  const namespaces = subpaths.map(
    (subpath, index) => `import * as entry${index} from "${manifest.name}/${subpath.slice(2)}";`
  );
  const entries = subpaths.map((subpath, index) => `  ${JSON.stringify(subpath)}: entry${index},`);
  return `import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
${namespaces.join("\n")}
import { NodePlatformLive } from "${manifest.name}/node/effect";
import { PlatformService } from "${manifest.name}/platform/effect";

const entries: Record<string, object> = {
${entries.join("\n")}
};
const host = realpathSync(fileURLToPath(import.meta.resolve("effect/package.json")));
for (const [subpath, namespace] of Object.entries(entries)) {
  assert.ok(Object.keys(namespace).length > 0, \`\${subpath} exports nothing at runtime\`);
  const entryFile = fileURLToPath(import.meta.resolve(\`${manifest.name}/\${subpath.slice(2)}\`));
  const kit = realpathSync(createRequire(entryFile).resolve("effect/package.json"));
  assert.equal(kit, host, \`\${subpath} resolves another copy of effect than the host\`);
}
const { version } = JSON.parse(readFileSync(host, "utf8")) as { version: string };
assert.equal(version, ${JSON.stringify(manifest.peerDependencies.effect)});

const program = Effect.gen(function* () {
  const platform = yield* PlatformService;
  return platform.home;
});
const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(NodePlatformLive)));
if (!Exit.isSuccess(exit)) {
  assert.fail(\`the program failed: \${Cause.pretty(exit.cause)}\`);
}
assert.equal(exit.value, ${JSON.stringify(home)});
console.log(\`effect \${version}\`);
`;
}

/**
 * Real paths of the packages named effect that Node resolution can reach from `nodeModules`: top-level, scoped and
 * nested folders, followed through links. Each `node_modules` folder is read once, so a link cycle ends.
 */
function effectCopies(nodeModules: string): string[] {
  const copies = new Set<string>();
  const visited = new Set<string>();
  const visit = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    const real = realpathSync(dir);
    if (visited.has(real)) {
      return;
    }
    visited.add(real);
    for (const name of readdirSync(real)) {
      if (name.startsWith(".")) {
        continue;
      }
      const folders = name.startsWith("@")
        ? readdirSync(join(real, name)).map((child) => join(real, name, child))
        : [join(real, name)];
      for (const folder of folders) {
        const manifest = join(folder, "package.json");
        if (
          existsSync(manifest) &&
          (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === "effect"
        ) {
          copies.add(realpathSync(folder));
        }
        visit(join(folder, "node_modules"));
      }
    }
  };
  visit(nodeModules);
  return [...copies];
}

function npmInstall(cwd: string, specs: readonly string[]): void {
  writeFileSync(join(cwd, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`);
  run(
    "npm",
    [
      "install",
      ...specs,
      "--registry",
      "https://registry.npmjs.org/",
      "--no-audit",
      "--no-fund",
      "--loglevel",
      "error"
    ],
    cwd,
    npmEnv
  );
}

/** Type-checks `consumer.ts` in `cwd` under node16 and bundler resolution. */
function typecheck(cwd: string, lib: readonly string[]): void {
  for (const [name, module, moduleResolution] of [
    ["node16", "node16", "node16"],
    ["bundler", "preserve", "bundler"]
  ] as const) {
    writeFileSync(join(cwd, `tsconfig.${name}.json`), tsconfig(module, moduleResolution, lib));
    run(tsc, ["-p", `tsconfig.${name}.json`], cwd);
  }
}

function tsconfig(module: string, moduleResolution: string, lib: readonly string[]): string {
  const compilerOptions = {
    module,
    moduleResolution,
    target: "ES2024",
    lib,
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

  const tarball = join(work, packed.filename);
  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  npmInstall(consumer, [tarball]);
  if (effectCopies(join(consumer, "node_modules")).length > 0) {
    throw new Error("npm installed effect, which must stay an optional peer");
  }

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
  typecheck(consumer, ["ES2024"]);
  const output = run(process.execPath, ["consumer.ts"], consumer).trim();

  writeFileSync(join(consumer, "cold-start.mjs"), coldStartSource(manifest));
  const coldStart = hookColdStartMs(consumer);
  if (!(coldStart < HOOK_COLD_START_BOUND_MS)) {
    throw new Error(`/harness/events took ${coldStart} ms to import and read one payload`);
  }

  const effectConsumer = join(work, "effect-consumer");
  mkdirSync(effectConsumer);
  npmInstall(effectConsumer, [tarball, `effect@${manifest.peerDependencies.effect}`]);
  const copies = effectCopies(join(effectConsumer, "node_modules"));
  if (copies.length !== 1) {
    throw new Error(`expected one copy of effect, found ${copies.length}: ${copies.join(", ")}`);
  }
  writeFileSync(join(effectConsumer, "consumer.ts"), effectConsumerSource(manifest, home));
  // effect's own declarations name DOM types such as TextDecoderOptions.
  typecheck(effectConsumer, ["ES2024", "DOM"]);
  // os.homedir() reads HOME, so NodePlatformLive builds its platform with the temporary home.
  const effectOutput = run(process.execPath, ["consumer.ts"], effectConsumer, { ...process.env, HOME: home }).trim();

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `smoke-consumer: ok in ${seconds}s (${packed.files.length} files; ${output.split("\n").join(", ")}; ` +
      `/harness/events cold start ${coldStart.toFixed(1)} ms; ${effectOutput} once, shared with the host)`
  );
} catch (error) {
  console.error(`smoke-consumer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
