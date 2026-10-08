import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import type { RunResult } from "@rivus/agent-kit-platform";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { ArtifactSource } from "../domain/bundle/index.js";
import type { ArtifactKind, ArtifactLocator } from "../domain/install-plan/index.js";
import type {
  ArtifactContent,
  InvalidLedger,
  LedgerBusy,
  LedgerSnapshot,
  LedgerVersionUnsupported
} from "../domain/ledger/index.js";

/** A file or directory could not be read or changed; what is on disk may be partly changed for a write. */
export interface ArtifactIoFailure {
  readonly _tag: "ArtifactIoFailure";
  readonly path: string;
  readonly operation: "read" | "write" | "remove";
  readonly message: string;
  readonly cause?: unknown;
}

/** A configuration file that does not parse; harness leaves it alone rather than rewrite it. */
export interface DocumentInvalid {
  readonly _tag: "DocumentInvalid";
  readonly format: "json" | "toml";
  readonly detail: string;
  readonly path?: string;
}

/** The document holds something other than the shape an entry needs, such as a string where a hook list belongs. */
export interface UnexpectedShape {
  readonly _tag: "UnexpectedShape";
  readonly detail: string;
  readonly path?: string;
}

export type ArtifactFailure = ArtifactIoFailure | DocumentInvalid | UnexpectedShape;

/** What is at a locator, with any symlink at it, in its ancestors, or inside its directory reported for write guards. */
export interface ArtifactRead {
  readonly kind: ArtifactKind;
  readonly content: ArtifactContent;
  readonly symlinkTarget?: string;
}

/** One entry edit for a preview: the content the entry gets, or `undefined` for its removal. */
export interface EntryChange {
  readonly locator: ArtifactLocator;
  readonly content: ArtifactContent | undefined;
}

/**
 * Reads and changes Artifacts at their locators: whole files and directories, and entries inside JSON (with
 * comments) and TOML configuration files, edited in place so that the rest of the file keeps its formatting and
 * comments. Calling convention:
 *
 * - Paths follow the ArtifactLocator path convention; symlinks at the Artifact, in its ancestors, or inside its
 *   directory block writes and removals. Apply rechecks these before each step; IO checks again before mutations.
 *   A non-cooperating writer can still substitute a path between a check and an IO operation; no atomic CAS is promised.
 * - A write re-reads a shared file and edits it right before replacing it atomically. A writer that does not take the
 *   LedgerLock can still change the file in between, and that change is lost without a trace; no CAS is promised.
 * - A directory's content is its files by relative path; removing it removes those files and the directories they
 *   leave empty.
 */
export interface ArtifactFilesShape {
  read(locator: ArtifactLocator): Effect.Effect<ArtifactRead | undefined, ArtifactFailure>;
  write(locator: ArtifactLocator, content: ArtifactContent): Effect.Effect<void, ArtifactFailure>;
  remove(locator: ArtifactLocator): Effect.Effect<void, ArtifactFailure>;
  scan(
    source: ArtifactSource
  ): Effect.Effect<readonly { readonly locator: ArtifactLocator; readonly read: ArtifactRead }[], ArtifactFailure>;
  /** A file's text before and after the entry changes, without writing; `undefined` where there is no file. */
  preview(
    path: string,
    format: "json" | "toml",
    changes: readonly EntryChange[]
  ): Effect.Effect<{ readonly before?: string; readonly after?: string }, ArtifactFailure>;
}

const ARTIFACT_FILES = "@rivus/agent-kit/harness/ArtifactFiles/v1";
// isolatedDeclarations rejects a call expression in `extends`, so each generated base class gets an explicit type.
const ArtifactFilesBase: Context.ServiceClass<ArtifactFiles, typeof ARTIFACT_FILES, ArtifactFilesShape> =
  Context.Service<ArtifactFiles, ArtifactFilesShape>()(ARTIFACT_FILES);

/** The port for the agents' files; `PlatformArtifactFilesLive` provides it over `PlatformService`. */
export class ArtifactFiles extends ArtifactFilesBase {}

/** Which ledger: one per scope, `user` or a project. */
export interface LedgerScope {
  /** A file-name-safe name: `user`, or `project-` and a hash of the project root. */
  readonly key: string;
  readonly scope: "user" | "project";
  readonly projectRoot?: string;
}

/** The ledger repository could not read or write; the ledger is as it was, or as the interrupted write left it. */
export interface LedgerRepositoryFailure {
  readonly _tag: "LedgerRepositoryFailure";
  readonly scope: string;
  readonly reason: "io" | "invalid-file" | "missing-pre-image";
  readonly message: string;
  readonly cause?: unknown;
}

/**
 * Another writer wrote over the revision a `save` was conditioned on, so it wrote nothing. Declared here, next to the
 * port; other contexts declare their own.
 */
export interface RevisionConflict {
  readonly _tag: "RevisionConflict";
  readonly scope: string;
  /** The revision the save was conditioned on; `undefined` when it required no stored ledger. */
  readonly expected: number | undefined;
  /** The revision the stored ledger had when the save compared it; `undefined` when there was none. */
  readonly stored: number | undefined;
}

/**
 * Where ledgers and their pre-images live. Calling convention:
 *
 * - `load` checks `schemaVersion` before anything else and fails with `LedgerVersionUnsupported` for a ledger it does
 *   not know, which stays on disk untouched; it never returns a ledger it could not validate.
 * - `save` writes only over the revision `expected` (`undefined`: nothing stored) and fails with `RevisionConflict`
 *   instead of writing otherwise. That comparison is enough because every writer holds the scope's LedgerLock; the
 *   repository does not lock by itself.
 * - Pre-images are content-addressed and never deleted by `save`, so a ledger always finds the blobs it names.
 * - Only local directories are supported.
 */
export interface LedgerRepositoryShape {
  load(
    scope: LedgerScope
  ): Effect.Effect<LedgerSnapshot | undefined, LedgerRepositoryFailure | LedgerVersionUnsupported | InvalidLedger>;
  save(
    scope: LedgerScope,
    snapshot: LedgerSnapshot,
    expected: number | undefined
  ): Effect.Effect<void, LedgerRepositoryFailure | LedgerVersionUnsupported | RevisionConflict>;
  putPreImage(scope: LedgerScope, content: ArtifactContent): Effect.Effect<string, LedgerRepositoryFailure>;
  getPreImage(scope: LedgerScope, blobRef: string): Effect.Effect<ArtifactContent, LedgerRepositoryFailure>;
}

const LEDGER_REPOSITORY = "@rivus/agent-kit/harness/LedgerRepository/v1";
const LedgerRepositoryBase: Context.ServiceClass<LedgerRepository, typeof LEDGER_REPOSITORY, LedgerRepositoryShape> =
  Context.Service<LedgerRepository, LedgerRepositoryShape>()(LEDGER_REPOSITORY);

/** The ledger repository port; `FileLedgerRepositoryLive` keeps ledgers under `$XDG_STATE_HOME`. */
export class LedgerRepository extends LedgerRepositoryBase {}

/**
 * Neither `platform.sqlite` nor an injected LedgerLock is available, so harness refuses to modify the ledger rather
 * than modify it without mutual exclusion.
 */
export interface LedgerLockUnavailable {
  readonly _tag: "LedgerLockUnavailable";
  readonly scope: string;
  readonly message: string;
}

/** Taking the lock failed for a reason other than another holder, such as an unwritable state directory. */
export interface LedgerLockFailure {
  readonly _tag: "LedgerLockFailure";
  readonly scope: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface LedgerLockOptions {
  /** How long to wait for another holder before failing with `LedgerBusy`; `0` tries once. Interrupting stops waiting. */
  readonly waitMs: number;
}

/**
 * Mutual exclusion for one scope's ledger. Calling convention for every implementation, injected ones included:
 *
 * - `acquire` holds the lock until the caller's Scope closes. The holder keeps it for as long as it lives and loses it
 *   when its process dies, without a reclaim step that another process could race.
 * - Taking the lock and registering its release happen in one uninterruptible step; a lock obtained after the waiter
 *   was interrupted is released at once.
 * - Only local directories are supported.
 */
export interface LedgerLockShape {
  acquire(
    scope: LedgerScope,
    options: LedgerLockOptions
  ): Effect.Effect<void, LedgerBusy | LedgerLockUnavailable | LedgerLockFailure, Scope.Scope>;
  /** What the current holder recorded about itself, for diagnostics; it may be stale. */
  holder(scope: LedgerScope): Effect.Effect<string | undefined>;
}

const LEDGER_LOCK = "@rivus/agent-kit/harness/LedgerLock/v1";
const LedgerLockBase: Context.ServiceClass<LedgerLock, typeof LEDGER_LOCK, LedgerLockShape> = Context.Service<
  LedgerLock,
  LedgerLockShape
>()(LEDGER_LOCK);

/** The LedgerLock port; `SqliteLedgerLockLive` provides it with an exclusive SQLite lock per scope. */
export class LedgerLock extends LedgerLockBase {}

/** An agent command line could not run, or exited with a failure. */
export interface AgentCliFailure {
  readonly _tag: "AgentCliFailure";
  readonly agent: CodingAgentId;
  readonly command: string;
  readonly args: readonly string[];
  readonly reason: "not-found" | "failed" | "timed-out";
  readonly message: string;
}

/** One call of an agent's own command line, such as registering a plugin. */
export interface AgentCommand {
  readonly agent: CodingAgentId;
  /** The executable's name, looked up on the platform's `PATH`. */
  readonly command: string;
  readonly args: readonly string[];
}

/** Runs agent command lines; `ProcessAgentCliLive` runs them through `Platform.process.run`. */
export interface AgentCliShape {
  /** Whether `command` is on `PATH`, so that a strategy that needs it can be chosen. */
  available(command: string): Effect.Effect<boolean>;
  /** Runs the command; a non-zero exit fails with `failed`. Results of a timed-out run are unknown and not retried. */
  run(command: AgentCommand): Effect.Effect<RunResult, AgentCliFailure>;
}

const AGENT_CLI = "@rivus/agent-kit/harness/AgentCli/v1";
const AgentCliBase: Context.ServiceClass<AgentCli, typeof AGENT_CLI, AgentCliShape> = Context.Service<
  AgentCli,
  AgentCliShape
>()(AGENT_CLI);

export class AgentCli extends AgentCliBase {}

/**
 * Tools outside harness that own files, such as chezmoi for dotfiles. Read-only: harness asks which of some paths
 * they manage and never changes their state. A tool that is not installed manages nothing.
 */
export interface ExternalOwnerShape {
  /** The paths of `paths` that a tool manages, with the tool's name. */
  managedPaths(paths: readonly string[]): Effect.Effect<ReadonlyMap<string, string>>;
}

const EXTERNAL_OWNER = "@rivus/agent-kit/harness/ExternalOwner/v1";
const ExternalOwnerBase: Context.ServiceClass<ExternalOwner, typeof EXTERNAL_OWNER, ExternalOwnerShape> =
  Context.Service<ExternalOwner, ExternalOwnerShape>()(EXTERNAL_OWNER);

/** The ExternalOwner port; `ChezmoiExternalOwnerLive` asks `chezmoi managed`. */
export class ExternalOwner extends ExternalOwnerBase {}
