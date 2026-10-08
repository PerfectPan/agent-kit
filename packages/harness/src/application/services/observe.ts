import type { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import type { CliRegistration, InstallAdapters, InstallContext } from "../../domain/bundle/index.js";
import { type ArtifactLocator, isWithin, type ObservedArtifact } from "../../domain/install-plan/index.js";
import { hashContent } from "./content-hash.js";
import { ArtifactFiles, type ArtifactFailure, type ArtifactRead } from "../ports.js";
import { resolvePath } from "./resolve-path.js";

/** The command lines behind a `cli-registration` locator, from whichever adapter renders it. */
export type RegistrationLookup = (
  locator: ArtifactLocator
) => (CliRegistration & { readonly roots?: readonly string[] }) | undefined;

export function registrationLookup(adapters: InstallAdapters, context: InstallContext): RegistrationLookup {
  return (locator) => {
    for (const adapter of Object.values(adapters)) {
      const registration = adapter?.cliRegistration?.(locator, context);
      if (registration !== undefined) {
        return { ...registration, roots: adapter?.roots(context) ?? [] };
      }
    }
    return undefined;
  };
}

/** Resolve declared agent homes, never a link below them: the command line also writes those descendant paths. */
export function registrationState(
  locator: ArtifactLocator,
  registrations?: RegistrationLookup
): Effect.Effect<
  { readonly registration?: CliRegistration; readonly copy?: ArtifactRead; readonly symlinkTarget?: string },
  ArtifactFailure,
  ArtifactFiles | PlatformService
> {
  return Effect.gen(function* () {
    const registration = registrations?.(locator);
    if (registration === undefined) {
      return {};
    }
    const roots: { path: string; resolved: string }[] = [];
    for (const path of registration.roots ?? []) {
      roots.push({ path, resolved: yield* resolvePath(path, true) });
    }
    const normalize = (path: string): string => {
      const root = roots.find((root) => isWithin(path, root.path));
      return root === undefined ? path : `${root.resolved}${path.slice(root.path.length)}`;
    };
    const normalized: CliRegistration = {
      ...registration,
      ...(registration.installedCopy === undefined ? {} : { installedCopy: normalize(registration.installedCopy) }),
      ...(registration.recorded === undefined
        ? {}
        : {
            recorded: {
              entries: registration.recorded.entries.map((entry) => ({ ...entry, path: normalize(entry.path) })),
              copies: registration.recorded.copies.map(normalize)
            }
          })
    };
    // Bind the command's own record path to the planned locator, not to any other allowed root containing it.
    const ownRecord = normalized.recorded?.entries.find(
      (entry) => entry.pointer === locator.pointer && entry.member === locator.member
    );
    let symlinkTarget = ownRecord !== undefined && ownRecord.path !== locator.path ? ownRecord.path : undefined;
    const files = yield* ArtifactFiles;
    for (const target of [
      { kind: "file" as const, path: locator.path },
      ...(normalized.recorded?.entries ?? []).map((entry): ArtifactLocator => ({ kind: "file", path: entry.path })),
      ...(normalized.recorded?.copies ?? []).map((path): ArtifactLocator => ({ kind: "dir", path }))
    ]) {
      symlinkTarget ??= (yield* files.read(target))?.symlinkTarget;
    }
    const copy =
      normalized.installedCopy === undefined
        ? undefined
        : yield* files.read({ kind: "file", path: normalized.installedCopy });
    symlinkTarget ??= copy?.symlinkTarget;
    return {
      registration: normalized,
      ...(copy === undefined ? {} : { copy }),
      ...(symlinkTarget === undefined ? {} : { symlinkTarget })
    };
  });
}

/** What was found at a locator, as the domain observes it: the kind found, its hash and its content. */
export function observation(locator: ArtifactLocator, read: ArtifactRead): Effect.Effect<ObservedArtifact> {
  const kind = locator.kind === "file" || locator.kind === "dir" ? read.kind : locator.kind;
  return Effect.map(hashContent(read.kind, read.content), (hash) => ({
    locator: kind === locator.kind ? locator : { ...locator, kind },
    hash,
    content: read.content,
    ...(read.symlinkTarget === undefined ? {} : { symlinkTarget: read.symlinkTarget })
  }));
}

/**
 * What is at a locator now. A command-line registration that the agent copies, such as a Codex plugin in its cache,
 * reads as that copy's text while enabled, so that an outdated copy is planned again; an explicitly disabled record
 * reads as `false`. Without a copy, an active registration reads as `true`.
 */
export function observe(
  locator: ArtifactLocator,
  registrations?: RegistrationLookup
): Effect.Effect<ObservedArtifact | undefined, ArtifactFailure, ArtifactFiles | PlatformService> {
  return Effect.gen(function* () {
    const files = yield* ArtifactFiles;
    const read = yield* files.read(locator);
    const state = locator.kind === "cli-registration" ? yield* registrationState(locator, registrations) : {};
    if (read === undefined) {
      return state.symlinkTarget === undefined
        ? undefined
        : yield* observation(locator, { kind: locator.kind, content: "", symlinkTarget: state.symlinkTarget });
    }
    const content =
      state.registration?.installedCopy === undefined || read.content === false
        ? read.content
        : state.copy?.kind === "file"
          ? state.copy.content
          : true;
    const symlinkTarget = read.symlinkTarget ?? state.symlinkTarget;
    return yield* observation(locator, { ...read, content, ...(symlinkTarget === undefined ? {} : { symlinkTarget }) });
  });
}
