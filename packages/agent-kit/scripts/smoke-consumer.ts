import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Packs the shell and the other packages of its release set with pnpm, as `rush publish` does, installs the tarballs
// into a throwaway consumer project the way a user would, and checks them from there: each tarball holds only what it
// should, every entry type-checks under node16 and bundler resolution, every entry loads in Node and reads sessions
// and their usage from a temporary home, `/cost` prices that usage, `/discovery` finds a fake agent, the companions
// run their own checks, and the hook entry starts fast in a fresh process. That consumer does not install effect, so
// it loads only the plain entries. A second consumer installs effect itself and runs a program on the Effect entries
// with exactly one copy of effect and of the shell in its tree, including one ACP turn with the test suite's fake
// agent, which speaks ACP through the SDK the tarball installs. The real home directory is never read.

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const fixtures = join(repoRoot, "packages/testing/test/fixtures");
const fakeAgent = join(repoRoot, "packages/acp/test/fixtures/fake-agent.ts");
const tsc = join(packageRoot, "node_modules/.bin/tsc");
// Rush's own pnpm: it rewrites `workspace:` ranges in the packed manifests the way publishing does.
const pnpm = join(repoRoot, "common/temp/pnpm-local/node_modules/.bin/pnpm");
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

/** A stand-in `codex` for `/discovery`: it prints a version and reports that nobody is logged in. */
const FAKE_CODEX = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 9.9.9"; exit 0; fi
if [ "$1 $2" = "login status" ]; then echo "Not logged in" >&2; exit 1; fi
exit 2
`;

const ROOT_FILES = new Set(["package.json", "README.md", "LICENSE"]);

/** The entries that import the optional `effect` peer, as in check-dist.ts; a stale list fails one of the consumers. */
const EFFECT_ENTRIES = new Set(["./acp", "./harness", "./node/effect", "./platform/effect", "./testing/effect"]);

/** What a companion package adds to a consumer: imports at the top, statements after the shell's checks. */
interface ConsumerCode {
  readonly imports: string;
  readonly body: string;
}

interface Companion {
  /** Its Effect entries, as in its own check-dist.ts. */
  readonly effectEntries: ReadonlySet<string>;
  /** Code for the consumer without effect, which has `platform` (on the temporary home) and `work` in scope. */
  plain(): ConsumerCode;
  /** Code for the consumer with effect, which has `work` in scope. */
  effect(): ConsumerCode;
}

/**
 * The other packages of the shell's lockstep version policy in rush.json, released and installed together with it.
 * The smoke test fails when the policy has a package this table lacks.
 */
const COMPANIONS: Readonly<Record<string, Companion>> = {
  "@rivus/agent-kit-collab": {
    effectEntries: new Set(["./lanes", "./lease"]),
    plain: () => ({
      imports: `import { acquireProcessLock } from "@rivus/agent-kit-collab/process-lock";`,
      body: `const lockPath = join(work, "smoke.lock");
const lock = await acquireProcessLock(platform, lockPath);
assert.ok(lock.ok, "acquireProcessLock refused a free lock");
const again = await acquireProcessLock(platform, lockPath);
assert.equal(again.ok ? "acquired twice" : again.error._tag, "ProcessLockHeld");
await lock.value.release();
console.log(\`process lock: \${lock.value.mechanism}\`);`
    }),
    effect: () => ({
      imports: `import { createLanes } from "@rivus/agent-kit-collab/lanes";
import { createLeaseManager, sqliteLeaseRepository } from "@rivus/agent-kit-collab/lease";`,
      body: `const leaseProgram = Effect.gen(function* () {
  const leases = yield* createLeaseManager({ ttlMs: 2000, heartbeatMs: 500 });
  const fenced = yield* Effect.scoped(
    Effect.flatMap(leases.acquire("smoke"), (lease) => lease.runFenced((token) => Effect.succeed(token.generation)))
  );
  const again = yield* Effect.scoped(Effect.map(leases.acquire("smoke"), (lease) => lease.token.generation));
  return [fenced, again];
});
const leaseLive = sqliteLeaseRepository({ path: join(work, "leases.db") }).pipe(Layer.provideMerge(NodePlatformLive));
const leaseExit = await Effect.runPromiseExit(leaseProgram.pipe(Effect.provide(leaseLive)));
if (!Exit.isSuccess(leaseExit)) {
  assert.fail(\`the lease program failed: \${Cause.pretty(leaseExit.cause)}\`);
}
assert.deepEqual(leaseExit.value, [1, 2]);
console.log("lease generations 1, 2");

const served: string[] = [];
const lanesProgram = Effect.scoped(
  Effect.gen(function* () {
    const lanes = yield* createLanes({
      maxConcurrent: 1,
      maxQueued: 1,
      activate: (key) => Effect.sync(() => served.push(key))
    });
    const wakes = [yield* lanes.wake("a"), yield* lanes.wake("a"), yield* lanes.wake("b")];
    while ((yield* lanes.status).lanes.length > 0) {
      yield* Effect.sleep(5);
    }
    return wakes;
  })
);
const lanesExit = await Effect.runPromiseExit(lanesProgram);
if (!Exit.isSuccess(lanesExit)) {
  assert.fail(\`the lanes program failed: \${Cause.pretty(lanesExit.cause)}\`);
}
assert.deepEqual(lanesExit.value, ["started", "coalesced", "queued"]);
assert.deepEqual(served, ["a", "b", "a"]);
console.log(\`lanes served \${served.join(", ")}\`);`
    })
  }
};

interface Manifest {
  name: string;
  version: string;
  exports: Record<string, unknown>;
  peerDependencies: { effect: string };
}

interface ReleasePackage {
  readonly folder: string;
  readonly manifest: Manifest;
  readonly effectEntries: ReadonlySet<string>;
  readonly companion: Companion | undefined;
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

/** Every `<package>/<subpath>` of the release set whose entry does, or does not, import effect. */
function entrySpecifiers(packages: readonly ReleasePackage[], effect: boolean): string[] {
  return packages.flatMap(({ manifest, effectEntries }) =>
    Object.keys(manifest.exports)
      .filter((subpath) => subpath !== "./package.json" && effectEntries.has(subpath) === effect)
      .map((subpath) => `${manifest.name}/${subpath.slice(2)}`)
  );
}

function shellOnly(): never {
  throw new Error("the release set is empty");
}

/**
 * A consumer module that imports every plain entry of the release set, lists and reads the seeded sessions through
 * Node, detects the fake `codex` in `bin`, and runs the companions' plain checks.
 */
function consumerSource(packages: readonly ReleasePackage[], home: string, work: string, bin: string): string {
  const [{ manifest } = shellOnly()] = packages;
  const specifiers = entrySpecifiers(packages, false);
  const namespaces = specifiers.map((specifier, index) => `import * as entry${index} from "${specifier}";`);
  const entries = specifiers.map((specifier, index) => `  ${JSON.stringify(specifier)}: entry${index},`);
  const companions = packages.flatMap(({ companion }) => (companion === undefined ? [] : [companion.plain()]));
  return `import assert from "node:assert/strict";
import { join } from "node:path";

${namespaces.join("\n")}
import { createPricing, summarize } from "${manifest.name}/cost";
import { createNodePlatform } from "${manifest.name}/node";
import type { Platform } from "${manifest.name}/platform";
import { detectAgents } from "${manifest.name}/discovery";
import { builtinSessionAdapters, isSessionHead, listSessions, type SessionHead } from "${manifest.name}/sessions";
import { loadTranscript, type RequestPayload } from "${manifest.name}/transcript";
import {
  addUsage,
  isUsageRecord,
  scanUsage,
  type Usage,
  type UsageRecord
} from "${manifest.name}/transcript/usage";
${companions.map((code) => code.imports).join("\n")}

const work = ${JSON.stringify(work)};
const entries: Record<string, object> = {
${entries.join("\n")}
};
for (const [specifier, namespace] of Object.entries(entries)) {
  assert.ok(Object.keys(namespace).length > 0, \`\${specifier} exports nothing at runtime\`);
}

const seeded: readonly string[] = ${JSON.stringify(SEEDS.map((seed) => seed.agent))};
assert.deepEqual(
  Object.keys(builtinSessionAdapters).toSorted(),
  seeded.toSorted(),
  "every built-in session adapter needs a row in SEEDS of smoke-consumer.ts"
);

// An empty env keeps the caller's CLAUDE_CONFIG_DIR, CODEX_HOME and the like from pointing at real agent homes.
const platform: Platform = createNodePlatform({ home: ${JSON.stringify(home)}, env: {} });
// Prices for the seeded sessions' models; Grok's session carries the cost Grok logged.
const pricing = createPricing({
  "claude-test": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWrite1h: 6 },
  "gpt-test": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 }
});
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
  const requests = transcript.value.events.filter((event) => event.kind === "request");
  const expected = requests.reduce<Usage>((sum, event) => addUsage(sum, (event.payload as RequestPayload).usage ?? {}), {});

  // The zero-dependency usage entry agrees with the transcript on the same session. The seeded files were last
  // written an hour ago, so the scan treats them as complete.
  let decoded: Usage = {};
  const records: UsageRecord[] = [];
  for await (const item of scanUsage(platform, { agents: [agent] })) {
    if (!isUsageRecord(item)) {
      assert.equal(item.error._tag, "RootMissing", \`\${agent}: cannot scan usage at \${item.path}\`);
      continue;
    }
    decoded = addUsage(decoded, item.usage);
    records.push(item);
  }
  assert.ok((decoded.totalTokens ?? 0) > 0, \`\${agent}: scanUsage found no usage\`);
  assert.deepEqual(decoded, expected, \`\${agent}: scanUsage and loadTranscript disagree\`);

  // /cost prices the decoded session and counts its tokens once.
  const summary = summarize(records, pricing);
  assert.deepEqual(summary.total.usage, decoded, \`\${agent}: summarize and scanUsage disagree\`);
  const cost = summary.total.costUsd;
  assert.ok(cost !== undefined && cost > 0, \`\${agent}: /cost priced nothing\`);
  console.log(\`\${agent}: \${transcript.value.events.length} events, \${decoded.totalTokens} tokens, $\${cost.toPrecision(3)}\`);
}

// Only the fake codex is on PATH; detection runs it for its version and, when asked to, its login status.
const detection = createNodePlatform({ home: ${JSON.stringify(home)}, env: { PATH: ${JSON.stringify(bin)} } });
const [codex] = await detectAgents(detection, { agents: ["codex"], authProbe: "commands" });
assert.ok(codex);
assert.equal(codex.status, "runnable", \`codex: \${JSON.stringify(codex.problems)}\`);
assert.equal(codex.version?.number, "9.9.9");
assert.equal(codex.auth.status, "logged-out");
console.log(\`discovery: codex \${codex.status} \${codex.version?.output}\`);
${companions.map((code) => code.body).join("\n")}
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
 * the peer version and that every companion entry resolves the host's copy of the shell, runs a program that reads
 * PlatformService through NodePlatformLive under the temporary home, and runs one prompt against the fake ACP agent
 * next to it, and installs and uninstalls a Claude Code bundle through `/harness`
 * under that home with an explicit environment.
 */
function effectConsumerSource(packages: readonly ReleasePackage[], home: string, work: string): string {
  const [{ manifest } = shellOnly()] = packages;
  const specifiers = entrySpecifiers(packages, true);
  const namespaces = specifiers.map((specifier, index) => `import * as entry${index} from "${specifier}";`);
  const entries = specifiers.map((specifier, index) => `  ${JSON.stringify(specifier)}: entry${index},`);
  const companionEntries = packages
    .slice(1)
    .flatMap((release) => [...entrySpecifiers([release], false), ...entrySpecifiers([release], true)]);
  const companions = packages.flatMap(({ companion }) => (companion === undefined ? [] : [companion.effect()]));
  return `import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
${namespaces.join("\n")}
import { type AcpProfile, connectAgent, MemorySessionBindingStoreLive } from "${manifest.name}/acp";
import * as Layer from "effect/Layer";
import { applyInstall, HarnessLive, inventory, planInstall, uninstall } from "${manifest.name}/harness";
import { createNodePlatform } from "${manifest.name}/node";
import { NodePlatformLive } from "${manifest.name}/node/effect";
import { PlatformService } from "${manifest.name}/platform/effect";
${companions.map((code) => code.imports).join("\n")}

const work = ${JSON.stringify(work)};
const entries: Record<string, object> = {
${entries.join("\n")}
};
const host = realpathSync(fileURLToPath(import.meta.resolve("effect/package.json")));
for (const [specifier, namespace] of Object.entries(entries)) {
  assert.ok(Object.keys(namespace).length > 0, \`\${specifier} exports nothing at runtime\`);
  const entryFile = fileURLToPath(import.meta.resolve(specifier));
  const kit = realpathSync(createRequire(entryFile).resolve("effect/package.json"));
  assert.equal(kit, host, \`\${specifier} resolves another copy of effect than the host\`);
}
const shell = realpathSync(fileURLToPath(import.meta.resolve("${manifest.name}/package.json")));
for (const specifier of ${JSON.stringify(companionEntries)}) {
  const entryFile = fileURLToPath(import.meta.resolve(specifier));
  const resolved = realpathSync(createRequire(entryFile).resolve("${manifest.name}/package.json"));
  assert.equal(resolved, shell, \`\${specifier} resolves another copy of ${manifest.name} than the host\`);
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
${companions.map((code) => code.body).join("\n")}

// One ACP turn: the fake agent runs under Node with no environment but the one given.
const fakeAgent: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: "fake-agent",
  command: process.execPath,
  args: [fileURLToPath(new URL("fake-agent.ts", import.meta.url))],
  env: [],
  systemPrompt: { in: "meta", key: "systemPrompt" },
  warnings: []
};
const turn = Effect.scoped(
  Effect.gen(function* () {
    const connection = yield* connectAgent("fake-agent", {
      cwd: process.cwd(),
      env: {},
      profiles: { "fake-agent": fakeAgent }
    });
    const session = yield* connection.newSession({ sessionKey: "smoke", systemPrompt: "be brief" });
    return yield* Stream.runCollect(session.prompt([{ type: "text", text: "echo hello" }]));
  })
);
const acp = await Effect.runPromiseExit(
  turn.pipe(Effect.provide(MemorySessionBindingStoreLive), Effect.provide(NodePlatformLive))
);
if (!Exit.isSuccess(acp)) {
  assert.fail(\`the ACP turn failed: \${Cause.pretty(acp.cause)}\`);
}
const events = acp.value.flatMap((part) => (part.type === "event" ? [part.event] : []));
assert.deepEqual(
  events.filter((event) => event.kind === "assistant").map((event) => event.payload.text),
  ["hello", "done"]
);
assert.equal(events.at(-1)?.payload.finishReason, "end_turn");
console.log(\`effect \${version}\`);
console.log(\`acp: \${acp.value.length} parts, \${events.length} events\`);

// Only HOME: no XDG_STATE_HOME or agent home override from the caller can point the ledger or the plugin elsewhere.
const harnessLayer = HarnessLive.pipe(
  Layer.provideMerge(Layer.succeed(PlatformService, createNodePlatform({ home: ${JSON.stringify(home)}, env: { HOME: ${JSON.stringify(home)} } })))
);
const hooksFile = ${JSON.stringify(`${home}/.claude/skills/smoke-app/hooks/hooks.json`)};
const install = Effect.gen(function* () {
  const bundle = {
    owner: "smoke-app",
    version: "1.0.0",
    digest: "smoke",
    artifacts: [{ type: "hooks" as const, command: "/opt/smoke/hook --agent {agent}", events: { "claude-code": ["Stop"] } }]
  };
  const plan = yield* planInstall(bundle, { agents: ["claude-code"] });
  // Planned paths are real paths, and the temporary directory can sit behind a symlink.
  assert.deepEqual(plan.changes.map((change) => change.path.slice(change.path.indexOf("/.claude/"))).toSorted(), [
    "/.claude/skills/smoke-app/.claude-plugin/plugin.json",
    "/.claude/skills/smoke-app/hooks/hooks.json"
  ]);
  const applied = yield* applyInstall(plan);
  const installed = JSON.parse(readFileSync(hooksFile, "utf8")) as { hooks: Record<string, unknown> };
  assert.deepEqual(Object.keys(installed.hooks), ["Stop"]);
  const removed = yield* uninstall("smoke-app");
  assert.equal((yield* inventory()).entries.length, 0);
  return \`\${applied.steps.length} step installed, \${removed.steps.length} removed\`;
});
const harness = await Effect.runPromiseExit(install.pipe(Effect.provide(harnessLayer)));
if (!Exit.isSuccess(harness)) {
  assert.fail(\`the harness program failed: \${Cause.pretty(harness.cause)}\`);
}
assert.throws(() => readFileSync(hooksFile, "utf8"));
console.log(\`/harness \${harness.value}\`);
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

/** The shell first, then the other packages of its version policy in rush.json, which are released with it. */
function releaseSet(shell: Manifest): ReleasePackage[] {
  const { projects } = JSON.parse(readFileSync(join(repoRoot, "rush.json"), "utf8")) as {
    projects: { packageName: string; projectFolder: string; versionPolicyName?: string }[];
  };
  const policy = projects.find((project) => project.packageName === shell.name)?.versionPolicyName;
  const others = projects.filter(
    (project) => policy !== undefined && project.versionPolicyName === policy && project.packageName !== shell.name
  );
  return [
    { folder: packageRoot, manifest: shell, effectEntries: EFFECT_ENTRIES, companion: undefined },
    ...others.map((project) => {
      const companion = COMPANIONS[project.packageName];
      if (companion === undefined) {
        throw new Error(`${project.packageName} is released with ${shell.name}; add it to COMPANIONS`);
      }
      const folder = join(repoRoot, project.projectFolder);
      const manifest = JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as Manifest;
      return { folder, manifest, effectEntries: companion.effectEntries, companion };
    })
  ];
}

function pack(folder: string, destination: string): PackResult {
  const packed = JSON.parse(
    run(pnpm, ["pack", "--json", "--pack-destination", destination], folder, npmEnv)
  ) as PackResult;
  return { ...packed, filename: resolve(destination, packed.filename) };
}

const started = performance.now();
const work = mkdtempSync(join(tmpdir(), "agent-kit-smoke-"));
try {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Manifest;
  const packages = releaseSet(manifest);
  const packs = packages.map(({ folder }) => pack(folder, work));
  const tarballs = packs.map((packed) => packed.filename);
  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  npmInstall(consumer, tarballs);
  if (effectCopies(join(consumer, "node_modules")).length > 0) {
    throw new Error("npm installed effect, which must stay an optional peer");
  }

  const problems = packages.flatMap((release, index) =>
    tarballProblems(
      (packs[index]?.files ?? []).map((file) => file.path),
      join(consumer, "node_modules", release.manifest.name)
    ).map((problem) => `${release.manifest.name}: ${problem}`)
  );
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }

  const home = join(work, "home");
  for (const seed of SEEDS) {
    mkdirSync(dirname(join(home, seed.target)), { recursive: true });
    cpSync(join(fixtures, seed.fixture), join(home, seed.target), { recursive: true });
  }
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  for (const entry of readdirSync(home, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      utimesSync(join(entry.parentPath, entry.name), anHourAgo, anHourAgo);
    }
  }

  const bin = join(work, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "codex"), FAKE_CODEX);
  chmodSync(join(bin, "codex"), 0o755);

  writeFileSync(join(consumer, "consumer.ts"), consumerSource(packages, home, work, bin));
  typecheck(consumer, ["ES2024"]);
  const output = run(process.execPath, ["consumer.ts"], consumer).trim();

  writeFileSync(join(consumer, "cold-start.mjs"), coldStartSource(manifest));
  const coldStart = hookColdStartMs(consumer);
  if (!(coldStart < HOOK_COLD_START_BOUND_MS)) {
    throw new Error(`/harness/events took ${coldStart} ms to import and read one payload`);
  }

  const effectConsumer = join(work, "effect-consumer");
  mkdirSync(effectConsumer);
  npmInstall(effectConsumer, [...tarballs, `effect@${manifest.peerDependencies.effect}`]);
  const copies = effectCopies(join(effectConsumer, "node_modules"));
  if (copies.length !== 1) {
    throw new Error(`expected one copy of effect, found ${copies.length}: ${copies.join(", ")}`);
  }
  writeFileSync(join(effectConsumer, "consumer.ts"), effectConsumerSource(packages, home, work));
  cpSync(fakeAgent, join(effectConsumer, "fake-agent.ts"));
  // effect's own declarations name DOM types such as TextDecoderOptions.
  typecheck(effectConsumer, ["ES2024", "DOM"]);
  // os.homedir() reads HOME, so NodePlatformLive builds its platform with the temporary home.
  const effectOutput = run(process.execPath, ["consumer.ts"], effectConsumer, { ...process.env, HOME: home }).trim();

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `smoke-consumer: ok in ${seconds}s (${packages.map((release) => release.manifest.name).join(" + ")}; ` +
      `${output.split("\n").join(", ")}; ` +
      `/harness/events cold start ${coldStart.toFixed(1)} ms; ${effectOutput.split("\n").join(", ")}; ` +
      "effect once, shared with the host)"
  );
} catch (error) {
  console.error(`smoke-consumer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
