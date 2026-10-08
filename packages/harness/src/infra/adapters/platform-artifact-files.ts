import { AgentKitError, ok, type Result } from "@rivus/agent-kit-catalog";
import type { Platform } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  ArtifactFiles,
  type ArtifactFailure,
  type ArtifactFilesShape,
  type ArtifactIoFailure,
  type ArtifactRead,
  type EntryChange
} from "../../application/ports.js";
import type { ArtifactSource } from "../../domain/bundle/index.js";
import type { ArtifactLocator } from "../../domain/install-plan/index.js";
import type { ArtifactContent, JsonValue } from "../../domain/ledger/index.js";
import { entryEdits, entryValue, listEntries } from "../services/config-entries.js";
import { editJsonc, parseJsonc } from "./jsonc-editor.js";
import { readText } from "../services/read-text.js";
import { editToml, parseToml } from "./toml-editor.js";

type FilesPlatform = Pick<Platform, "fs">;
type Format = "json" | "toml";

const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));

function io(path: string, operation: ArtifactIoFailure["operation"], cause: unknown): ArtifactIoFailure {
  return {
    _tag: "ArtifactIoFailure",
    path,
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause
  };
}

function attempt<A>(path: string, operation: ArtifactIoFailure["operation"], run: () => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: (cause) => io(path, operation, cause) });
}

function fromParse<A, E extends ArtifactFailure>(
  path: string,
  result: Result<A, E>
): Effect.Effect<A, ArtifactFailure> {
  return result.ok ? Effect.succeed(result.value) : Effect.fail({ ...result.error, path });
}

/** Every regular file under `dir`; links are reported separately and never followed. */
async function readTree(
  platform: FilesPlatform,
  dir: string,
  prefix = "",
  links: string[] = []
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  if ((await platform.fs.stat(dir))?.kind === "symlink") {
    links.push(dir);
    return files;
  }
  for (const entry of await platform.fs.list(dir)) {
    const path = `${dir}/${entry.name}`;
    const kind = (await platform.fs.stat(path))?.kind;
    if (kind === "symlink") {
      links.push(path);
    } else if (kind === "dir") {
      Object.assign(files, await readTree(platform, path, `${prefix}${entry.name}/`, links));
    } else if (kind === "file") {
      files[`${prefix}${entry.name}`] = (await readText(platform, path)) ?? "";
    }
  }
  return files;
}

/** Removes `dir` and the directories under it that hold nothing, deepest first; anything else stays. */
async function pruneEmpty(platform: FilesPlatform, dir: string): Promise<void> {
  const stat = await platform.fs.stat(dir);
  if (stat?.kind !== "dir") {
    return;
  }
  for (const entry of await platform.fs.list(dir)) {
    if (entry.kind === "dir") {
      await pruneEmpty(platform, `${dir}/${entry.name}`);
    }
  }
  if ((await platform.fs.list(dir)).length === 0) {
    await platform.fs.remove(dir);
  }
}

function formatOf(locator: ArtifactLocator): Format {
  return locator.kind === "toml-entry" ? "toml" : "json";
}

function parseDocument(format: Format, text: string): Result<unknown, ArtifactFailure> {
  return format === "toml" ? parseToml(text) : parseJsonc(text);
}

function editDocument(
  format: Format,
  text: string | undefined,
  data: unknown,
  locator: ArtifactLocator,
  value: JsonValue | undefined
): Result<string, ArtifactFailure> {
  const edits = entryEdits(data, locator, value);
  if (!edits.ok) {
    return edits;
  }
  return format === "toml" ? editToml(text, data, edits.value) : ok(editJsonc(text, edits.value));
}

function unsupported(locator: ArtifactLocator): never {
  throw new AgentKitError("capability-unsupported", `ArtifactFiles does not handle ${locator.kind} Artifacts`);
}

function makeArtifactFiles(platform: FilesPlatform): ArtifactFilesShape {
  const { fs } = platform;

  const linkedAncestor = async (path: string): Promise<string | undefined> => {
    for (let current = path; current !== ""; current = parentOf(current)) {
      if ((await fs.stat(current))?.kind === "symlink") {
        return (await fs.realpath(current)) ?? current;
      }
    }
    return undefined;
  };
  const writable = async (path: string): Promise<void> => {
    if ((await linkedAncestor(path)) !== undefined) {
      throw new Error(`Refusing to modify a symlinked path: ${path}`);
    }
  };

  /** The path itself as found, and what it points to when it is a symlink. */
  const inspect = (path: string) =>
    attempt(path, "read", async () => {
      const own = await fs.stat(path);
      if (own?.kind !== "symlink") {
        return { stat: own, symlinkTarget: await linkedAncestor(parentOf(path)) };
      }
      return { stat: await fs.stat(path, { followSymlinks: true }), symlinkTarget: (await fs.realpath(path)) ?? path };
    });

  const document = (path: string, format: Format) =>
    Effect.gen(function* () {
      const text = yield* attempt(path, "read", () => readText(platform, path));
      const data = text === undefined ? undefined : yield* fromParse(path, parseDocument(format, text));
      return { text, data };
    });

  const read = (locator: ArtifactLocator): Effect.Effect<ArtifactRead | undefined, ArtifactFailure> =>
    Effect.gen(function* () {
      const { path } = locator;
      const { stat, symlinkTarget } = yield* inspect(path);
      const link = symlinkTarget === undefined ? {} : { symlinkTarget };
      if (stat === undefined) {
        // A dangling link still occupies the path.
        return symlinkTarget === undefined ? undefined : { kind: "symlink", content: "", ...link };
      }
      switch (locator.kind) {
        case "file":
        case "dir":
          if (stat.kind === "dir") {
            const links: string[] = [];
            const content = yield* attempt(path, "read", () => readTree(platform, path, "", links));
            const target = symlinkTarget ?? links[0];
            return { kind: "dir", content, ...(target === undefined ? {} : { symlinkTarget: target }) };
          }
          return {
            kind: "file",
            content: (yield* attempt(path, "read", () => readText(platform, path))) ?? "",
            ...link
          };
        case "json-entry":
        case "toml-entry": {
          const { data } = yield* document(path, formatOf(locator));
          const value = yield* fromParse(path, entryValue(data, locator));
          return value === undefined ? undefined : { kind: locator.kind, content: value, ...link };
        }
        case "cli-registration": {
          // An explicitly disabled registration cannot run even when its cached content is unchanged.
          const format: Format = path.endsWith(".toml") ? "toml" : "json";
          const { data } = yield* document(path, format);
          const value = yield* fromParse(
            path,
            entryValue(data, { kind: "json-entry", path, pointer: locator.pointer ?? "" })
          );
          const enabled =
            typeof value !== "object" || value === null || (value as { enabled?: unknown }).enabled !== false;
          return value === undefined ? undefined : { kind: "cli-registration", content: enabled, ...link };
        }
        default:
          return unsupported(locator);
      }
    });

  const writeFile = (path: string, text: string) =>
    attempt(path, "write", async () => {
      await writable(path);
      await fs.mkdir(parentOf(path));
      await fs.writeAtomic(path, text);
    });

  const write = (locator: ArtifactLocator, content: ArtifactContent): Effect.Effect<void, ArtifactFailure> =>
    Effect.gen(function* () {
      const { path } = locator;
      switch (locator.kind) {
        case "file":
          return yield* writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
        case "dir": {
          const files = content as Readonly<Record<string, string>>;
          yield* attempt(path, "write", async () => {
            await writable(path);
            const links: string[] = [];
            const previous = (await fs.stat(path))?.kind === "dir" ? await readTree(platform, path, "", links) : {};
            if (links.length > 0) {
              throw new Error(`Refusing to modify a directory containing symlinks: ${path}`);
            }
            await fs.mkdir(path);
            // The precondition was re-checked just before, so files not in the new content are the old content's.
            for (const name of Object.keys(previous)) {
              if (!Object.hasOwn(files, name)) {
                await writable(`${path}/${name}`);
                await fs.remove(`${path}/${name}`);
              }
            }
            for (const [name, text] of Object.entries(files)) {
              await writable(`${path}/${name}`);
              await fs.mkdir(parentOf(`${path}/${name}`));
              await fs.writeAtomic(`${path}/${name}`, text);
            }
            for (const entry of await fs.list(path)) {
              if (entry.kind === "dir") {
                await pruneEmpty(platform, `${path}/${entry.name}`);
              }
            }
          });
          return;
        }
        case "json-entry":
        case "toml-entry": {
          const format = formatOf(locator);
          const { text, data } = yield* document(path, format);
          const next = yield* fromParse(path, editDocument(format, text, data, locator, content));
          return yield* writeFile(path, next);
        }
        default:
          return unsupported(locator);
      }
    });

  const remove = (locator: ArtifactLocator): Effect.Effect<void, ArtifactFailure> =>
    Effect.gen(function* () {
      const { path } = locator;
      switch (locator.kind) {
        case "file":
          return yield* attempt(path, "remove", async () => {
            await writable(path);
            await fs.remove(path);
          });
        case "dir":
          return yield* attempt(path, "remove", async () => {
            await writable(path);
            const stat = await fs.stat(path);
            if (stat?.kind !== "dir") {
              await fs.remove(path);
              return;
            }
            const links: string[] = [];
            const files = await readTree(platform, path, "", links);
            if (links.length > 0) {
              throw new Error(`Refusing to remove a directory containing symlinks: ${path}`);
            }
            for (const name of Object.keys(files)) {
              await writable(`${path}/${name}`);
              await fs.remove(`${path}/${name}`);
            }
            await pruneEmpty(platform, path);
          });
        case "json-entry":
        case "toml-entry": {
          const format = formatOf(locator);
          const { text, data } = yield* document(path, format);
          if (text === undefined) {
            return;
          }
          const next = yield* fromParse(path, editDocument(format, text, data, locator, undefined));
          return next === text ? undefined : yield* writeFile(path, next);
        }
        default:
          return unsupported(locator);
      }
    });

  const scan = (source: ArtifactSource) =>
    Effect.gen(function* () {
      if (source.kind === "file") {
        const locator: ArtifactLocator = { kind: "file", path: source.path };
        const found = yield* read(locator);
        return found === undefined ? [] : [{ locator, read: found }];
      }
      if (source.kind === "files") {
        const { dir } = source;
        const stat = yield* attempt(dir, "read", () => fs.stat(dir, { followSymlinks: true }));
        if (stat?.kind !== "dir") {
          return [];
        }
        const files = [];
        for (const entry of yield* attempt(dir, "read", () => fs.list(dir))) {
          if (entry.kind === "file" || entry.kind === "symlink") {
            const locator: ArtifactLocator = { kind: "file", path: `${dir}/${entry.name}` };
            const found = yield* read(locator);
            if (found?.kind === "file") {
              files.push({ locator, read: found });
            }
          }
        }
        return files;
      }
      const { path, format, pointer, memberIn } = source;
      const { symlinkTarget } = yield* inspect(path);
      const { data } = yield* document(path, format);
      const kind = format === "toml" ? "toml-entry" : "json-entry";
      return listEntries(data, pointer, memberIn).map((entry) => ({
        locator: { kind, path, ...entry.locator } as ArtifactLocator,
        read: {
          kind,
          content: entry.value,
          ...(symlinkTarget === undefined ? {} : { symlinkTarget })
        } satisfies ArtifactRead
      }));
    });

  const preview = (path: string, format: Format, changes: readonly EntryChange[]) =>
    Effect.gen(function* () {
      const { text: before } = yield* document(path, format);
      let after = before;
      for (const change of changes) {
        const data = after === undefined ? undefined : yield* fromParse(path, parseDocument(format, after));
        after = yield* fromParse(path, editDocument(format, after, data, change.locator, change.content));
      }
      return { ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) };
    });

  return { read, write, remove, scan, preview };
}

/**
 * The agents' files through `PlatformService`: JSON and JSONC entries edited with jsonc-parser, TOML entries with
 * `@decimalturn/toml-patch`, both keeping comments and formatting; whole files written atomically.
 */
export const PlatformArtifactFilesLive: Layer.Layer<ArtifactFiles, never, PlatformService> = Layer.effect(
  ArtifactFiles,
  Effect.gen(function* () {
    return makeArtifactFiles(yield* PlatformService);
  })
);
