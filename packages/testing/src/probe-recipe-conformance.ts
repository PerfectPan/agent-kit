import { builtinCodingAgents, isBuiltinCodingAgentId, parseCodingAgentId } from "@rivus/agent-kit-catalog";
import {
  type AuthReading,
  classifyInstallation,
  type CommandOutput,
  detectAgents,
  expandProbePath,
  type Installation,
  type ProbePath,
  type ProbeProblem,
  type ProbeRecipe,
  type Version
} from "@rivus/agent-kit-discovery";
import { isEqual, isPlainObject } from "es-toolkit";

import { createMemoryPlatform, type MemoryPlatform } from "./memory-platform.js";
import type { ConformanceCheck } from "./session-adapter-conformance.js";

/** Outputs a recipe's parsers must read, with what they must read from each (`undefined`: not recognized). */
export interface ProbeRecipeSamples {
  readonly versions?: readonly { readonly output: CommandOutput; readonly version: Version | undefined }[];
  readonly auth?: readonly { readonly output: CommandOutput; readonly reading: AuthReading | undefined }[];
  /**
   * Content of a credential file the recipe parses. `path` is the file as the recipe names it, with an agent home
   * written as its default under `~`, such as `~/.codex/auth.json`.
   */
  readonly credentialFiles?: readonly {
    readonly path: string;
    readonly json: unknown;
    readonly reading: AuthReading | undefined;
  }[];
}

/** Outputs no agent prints on purpose; a parser must return `undefined` or a well-formed value for each. */
const ODD_OUTPUTS: readonly CommandOutput[] = [
  { code: 0, stdout: "", stderr: "" },
  { code: 0, stdout: " \n\t\r\n", stderr: "" },
  { code: 1, stdout: "", stderr: "error: unknown option" },
  { code: null, stdout: "", stderr: "" },
  { code: -1, stdout: "Logged in", stderr: "Not logged in" },
  { code: 0, stdout: "null", stderr: "" },
  { code: 0, stdout: "{}", stderr: "" },
  { code: 0, stdout: "[1, 2]", stderr: "" },
  { code: 0, stdout: '{"loggedIn": "yes", "authMethod": 7, "status": 1}', stderr: "" },
  { code: 0, stdout: "{", stderr: "}" },
  { code: 0, stdout: "\u0000�\uD800 v", stderr: "\u0000" },
  { code: 0, stdout: "1.2.3\n".repeat(2_000), stderr: "" },
  { code: 0, stdout: "x".repeat(200_000), stderr: "" }
];

/** JSON values no credential file holds on purpose. */
const ODD_JSON: readonly unknown[] = [
  null,
  0,
  "",
  "token",
  [],
  [{ type: "api" }],
  {},
  { "": null },
  { auth_mode: 7, tokens: null },
  JSON.parse('{"__proto__": {"injected": true}, "constructor": "x"}'),
  Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`k${index}`, { type: index }]))
];

const HOME = "/u/me";
const BIN = "/opt/probe/bin";
/** Used when no version sample is given; the default version parser reads it. */
const DEFAULT_VERSION_OUTPUT: CommandOutput = { code: 0, stdout: "1.0.0\n", stderr: "" };

/** Problems of login checks, which a machine without login samples cannot avoid. */
const isAuthProblem = (problem: ProbeProblem): boolean =>
  problem._tag === "CredentialFileFailed" || (problem._tag === "CommandFailed" && problem.purpose === "auth");

function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function checkVersion(version: Version | undefined, output: CommandOutput): void {
  if (version === undefined) {
    return;
  }
  const what = `version ${JSON.stringify(version).slice(0, 80)} read from ${JSON.stringify(output).slice(0, 80)}`;
  check(isPlainObject(version) && typeof version.output === "string", `${what} has no output`);
  check(version.output !== "" && version.output.trim() === version.output, `${what} is blank or not trimmed`);
  check(
    version.number === undefined || (/\d/.test(version.number) && version.output.includes(version.number)),
    `${what} has a number that is not in its output`
  );
}

function checkReading(reading: AuthReading | undefined, input: unknown): void {
  if (reading === undefined) {
    return;
  }
  const what = `login ${JSON.stringify(reading)} read from ${String(JSON.stringify(input)).slice(0, 80)}`;
  check(isPlainObject(reading) && typeof reading.loggedIn === "boolean", `${what} has no loggedIn flag`);
  check(reading.method === undefined || (typeof reading.method === "string" && reading.method !== ""), `${what}`);
}

/**
 * A machine with every command of the recipe on `PATH` and every path it checks. Each command prints
 * `versionOutput` for the version arguments and the first login sample for the login arguments; a parsed credential
 * file holds its sample, or `{}`.
 */
function installedMachine(
  recipe: ProbeRecipe,
  samples: ProbeRecipeSamples,
  versionOutput: CommandOutput,
  sampleFor: (path: ProbePath) => { readonly json: unknown } | undefined
): MemoryPlatform {
  const expand = (path: ProbePath) => expandProbePath(path, { env: {}, home: HOME }, recipe);
  const credentials = new Map(
    (recipe.auth?.credentialFiles ?? []).map((file) => [
      expand(file.path),
      file.parse ? JSON.stringify(sampleFor(file.path)?.json ?? {}) : ""
    ])
  );
  const paths = [
    ...[...recipe.appPaths, ...recipe.configPaths, ...recipe.mcpConfigPaths].map(expand),
    ...credentials.keys()
  ];
  // A path that another path lies under is a directory; seeding the deeper path creates it.
  const leaves = paths.filter((path) => !paths.some((other) => other.startsWith(`${path}/`)));
  const authOutput = samples.auth?.[0]?.output;
  const answer = (args: readonly string[]): CommandOutput => {
    if (isEqual(args, recipe.version?.args)) {
      return versionOutput;
    }
    if (authOutput !== undefined && isEqual(args, recipe.auth?.command?.args)) {
      return authOutput;
    }
    return { code: 2, stdout: "", stderr: "unexpected arguments" };
  };
  return createMemoryPlatform({
    home: HOME,
    env: { PATH: BIN },
    files: Object.fromEntries([...leaves, `${HOME}/.probe-home`].map((path) => [path, credentials.get(path) ?? ""])),
    commands: Object.fromEntries(recipe.commands.map((command) => [`${BIN}/${command}`, answer]))
  });
}

/** A value no parser should ever pass on, shaped like an API key. */
const CANARY = "sk-ant-api03-Zq8vW2xK9mPf4LtRcN7bHy3D";
/** A reading leaks when it holds any part of the canary this long, such as the first characters of a token. */
const CANARY_PART = 8;

/** `json` with the canary in each string position in turn: every string value and every object key. */
function jsonVariants(json: unknown): unknown[] {
  if (typeof json === "string") {
    return [CANARY];
  }
  if (Array.isArray(json)) {
    return json.flatMap((item, index) =>
      jsonVariants(item).map((variant) => json.map((other, at) => (at === index ? variant : other)))
    );
  }
  if (isPlainObject(json)) {
    const entries = Object.entries(json);
    return entries.flatMap(([key, value], index) => [
      Object.fromEntries(entries.map((entry, at) => (at === index ? [CANARY, value] : entry))),
      ...jsonVariants(value).map((variant) =>
        Object.fromEntries(entries.map((entry, at) => (at === index ? [key, variant] : entry)))
      )
    ]);
  }
  return [];
}

/** A command output with the canary in each string position: JSON positions of a JSON output, else each word. */
function outputVariants(output: CommandOutput): CommandOutput[] {
  let json: unknown;
  try {
    json = JSON.parse(output.stdout);
  } catch {
    json = undefined;
  }
  if (json !== undefined && typeof json === "object" && json !== null) {
    return jsonVariants(json).map((variant) => ({ ...output, stdout: JSON.stringify(variant) }));
  }
  const words = (text: string): string[] =>
    [...text.matchAll(/\S+/g)].map(
      (match) => `${text.slice(0, match.index)}${CANARY}${text.slice(match.index + match[0].length)}`
    );
  return [
    ...words(output.stdout).map((stdout) => ({ ...output, stdout })),
    ...words(output.stderr).map((stderr) => ({ ...output, stderr }))
  ];
}

function checkNoCanary(reading: AuthReading | undefined, input: unknown): void {
  const text = JSON.stringify(reading ?? null);
  for (let at = 0; at + CANARY_PART <= CANARY.length; at += 1) {
    const part = CANARY.slice(at, at + CANARY_PART);
    check(
      !text.includes(part),
      `a login reading passed on ${JSON.stringify(part)} from its input: ${text} from ${JSON.stringify(input).slice(0, 120)}`
    );
  }
}

/**
 * The checks every probe recipe must pass, independent of a test runner: wire each into the runner, for example
 * `for (const { name, run } of probeRecipeConformance(recipe, samples)) it(name, run)`. `samples` adds the recipe's
 * own outputs; without them, the checks use outputs any version parser should read.
 */
export function probeRecipeConformance(recipe: ProbeRecipe, samples: ProbeRecipeSamples = {}): ConformanceCheck[] {
  const versionOutput =
    samples.versions?.find((sample) => sample.version !== undefined)?.output ?? DEFAULT_VERSION_OUTPUT;
  const credentialFiles = recipe.auth?.credentialFiles ?? [];
  const sampleFor = (path: ProbePath) =>
    samples.credentialFiles?.find((sample) => sample.path === expandProbePath(path, { env: {}, home: "~" }, recipe));
  const machine = () => installedMachine(recipe, samples, versionOutput, sampleFor);
  const detect = async (platform: MemoryPlatform): Promise<Installation> => {
    const [installation] = await detectAgents(platform, {
      recipes: { [recipe.agent]: recipe },
      timeoutMs: 1_000,
      authProbe: "commands"
    });
    check(installation !== undefined, `detectAgents reported nothing for ${recipe.agent}`);
    return installation;
  };

  return [
    {
      name: "names a catalog agent, or a third-party agent by a canonical id",
      run: async () => {
        // A conformance suite judges the recipe as given, and a JS adapter can author one that ignores ProbeRecipe.
        // oxlint-disable-next-line no-unnecessary-condition
        check(recipe.specificationVersion === "discovery-v1", `specificationVersion is ${recipe.specificationVersion}`);
        const parsed = parseCodingAgentId(recipe.agent);
        check(parsed.ok && parsed.value === recipe.agent, `${recipe.agent} is not a canonical agent id`);
        if (isBuiltinCodingAgentId(recipe.agent)) {
          const { displayName } = builtinCodingAgents[recipe.agent];
          check(recipe.displayName === displayName, `display name ${recipe.displayName}, catalog says ${displayName}`);
        } else {
          check(recipe.displayName.trim() !== "", "a third-party recipe needs a display name");
        }
      }
    },
    {
      name: "probes bare command names with fixed arguments",
      run: async () => {
        const paths = [...recipe.appPaths, ...recipe.configPaths, ...recipe.mcpConfigPaths];
        check(recipe.commands.length > 0 || paths.length > 0, "the recipe probes nothing");
        for (const command of recipe.commands) {
          check(/^[^\s/\\]+$/.test(command), `command ${JSON.stringify(command)} is not a bare executable name`);
        }
        const login = recipe.auth?.command;
        for (const args of [recipe.version?.args, login?.args]) {
          for (const arg of args ?? []) {
            check(arg !== "" && !arg.includes("\0"), `argument ${JSON.stringify(arg)} is empty or has a NUL`);
          }
        }
        for (const effects of [recipe.version?.sideEffects, login?.sideEffects]) {
          check(
            effects === undefined || (Array.isArray(effects) && effects.every((effect) => effect.trim() !== "")),
            "a probe command must list its known side effects"
          );
        }
        if (login !== undefined) {
          check(
            login.command === undefined ? recipe.commands.length > 0 : recipe.commands.includes(login.command),
            "the login command must be one of the recipe's commands"
          );
        }
        for (const { name } of recipe.auth?.env ?? []) {
          check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name), `${name} is not an environment variable name`);
        }
      }
    },
    {
      name: "checks only absolute, home-relative or agent-home paths",
      run: async () => {
        const all: ProbePath[] = [
          ...recipe.appPaths,
          ...recipe.configPaths,
          ...recipe.mcpConfigPaths,
          ...credentialFiles.map((file) => file.path)
        ];
        for (const path of all) {
          if (typeof path === "string") {
            check(/^(?:~(?:\/.*)?|\/.*|[A-Za-z]:[\\/].*)$/.test(path), `${path} is neither home-relative nor absolute`);
            continue;
          }
          check(
            path.path === undefined || !/^[/\\]|(?:^|[/\\])\.\.(?:[/\\]|$)/.test(path.path),
            `${path.path} must stay under the home of ${path.agentHome}`
          );
          expandProbePath(path, { env: {}, home: HOME }, recipe);
        }
      }
    },
    {
      name: "parsers accept any output without throwing",
      run: async () => {
        for (const output of [...ODD_OUTPUTS, ...(samples.versions ?? []).map((sample) => sample.output)]) {
          checkVersion(recipe.version?.parse(output), output);
        }
        for (const output of [...ODD_OUTPUTS, ...(samples.auth ?? []).map((sample) => sample.output)]) {
          checkReading(recipe.auth?.command?.parse(output), output);
        }
        for (const file of credentialFiles) {
          for (const json of [...ODD_JSON, ...(samples.credentialFiles ?? []).map((sample) => sample.json)]) {
            checkReading(file.parse?.(json), json);
          }
        }
      }
    },
    {
      name: "reads its sample outputs",
      run: async () => {
        for (const { output, version } of samples.versions ?? []) {
          check(recipe.version !== undefined, "version samples need a version probe");
          const read = recipe.version.parse(output);
          check(isEqual(read, version), `read version ${JSON.stringify(read)}, expected ${JSON.stringify(version)}`);
        }
        for (const { output, reading } of samples.auth ?? []) {
          check(recipe.auth?.command !== undefined, "login samples need a login command");
          const read = recipe.auth.command.parse(output);
          check(isEqual(read, reading), `read login ${JSON.stringify(read)}, expected ${JSON.stringify(reading)}`);
        }
        for (const { path, json, reading } of samples.credentialFiles ?? []) {
          const file = credentialFiles.find(
            (candidate) => expandProbePath(candidate.path, { env: {}, home: "~" }, recipe) === path
          );
          check(file?.parse !== undefined, `no credential file ${path} with a parser`);
          const read = file.parse(json);
          check(isEqual(read, reading), `read ${path} as ${JSON.stringify(read)}, expected ${JSON.stringify(reading)}`);
        }
      }
    },
    {
      name: "never returns a credential value from its login inputs",
      run: async () => {
        const rendered = (file: (typeof credentialFiles)[number]) =>
          expandProbePath(file.path, { env: {}, home: "~" }, recipe);
        check(
          recipe.auth?.command === undefined || (samples.auth ?? []).length > 0,
          "a login command needs at least one login sample"
        );
        for (const file of credentialFiles.filter((candidate) => candidate.parse !== undefined)) {
          check(
            (samples.credentialFiles ?? []).some((sample) => sample.path === rendered(file)),
            `the parsed credential file ${rendered(file)} needs at least one sample`
          );
        }
        for (const { output } of samples.auth ?? []) {
          for (const variant of outputVariants(output)) {
            checkNoCanary(recipe.auth?.command?.parse(variant), variant);
          }
        }
        for (const { path, json } of samples.credentialFiles ?? []) {
          const file = credentialFiles.find((candidate) => rendered(candidate) === path);
          for (const variant of jsonVariants(json)) {
            checkNoCanary(file?.parse?.(variant), variant);
          }
        }
      }
    },
    {
      name: "reports everything it probes on a machine that has it all",
      run: async () => {
        const installation = await detect(machine());
        const command = recipe.commands[0];
        check(
          installation.command === (command === undefined ? undefined : `${BIN}/${command}`),
          `command is ${installation.command}`
        );
        const readsVersion = recipe.version !== undefined && command !== undefined;
        const expected = readsVersion && recipe.version.parse(versionOutput) !== undefined ? "runnable" : "found";
        check(installation.status === expected, `status is ${installation.status}, expected ${expected}`);
        // Without login samples the machine cannot answer login checks the way the agent would.
        const problems = installation.problems.filter((problem) => !isAuthProblem(problem));
        check(problems.length === 0, `problems: ${JSON.stringify(problems)}`);
        const reported = new Set(installation.evidence.map((item) => `${item.kind} ${item.path}`));
        const expand = (path: ProbePath) => expandProbePath(path, { env: {}, home: HOME }, recipe);
        for (const [kind, paths] of [
          ["config", recipe.configPaths],
          ["mcp-config", recipe.mcpConfigPaths]
        ] as const) {
          for (const path of paths.map(expand)) {
            check(reported.has(`${kind} ${path}`), `no ${kind} evidence for ${path}`);
          }
        }
      }
    },
    {
      name: "reports missing with no evidence on an empty machine",
      run: async () => {
        const installation = await detect(createMemoryPlatform({ home: HOME, env: { PATH: BIN } }));
        check(installation.status === "missing", `status is ${installation.status}`);
        check(installation.evidence.length === 0, `evidence: ${JSON.stringify(installation.evidence)}`);
        check(installation.auth.status === "unknown", `login is ${installation.auth.status}`);
      }
    },
    {
      name: "classifies the same machine the same way",
      run: async () => {
        const first = await detect(machine());
        const shared = machine();
        for (const again of [await detect(machine()), await detect(shared), await detect(shared)]) {
          check(isEqual(again, first), "two detections of the same machine differ");
        }
        const reordered = classifyInstallation(first.evidence.toReversed(), first.problems.toReversed());
        check(reordered === first.status, `reordered evidence classifies as ${reordered}, not ${first.status}`);
      }
    }
  ];
}
