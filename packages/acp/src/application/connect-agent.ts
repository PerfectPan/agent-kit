import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import type { Env, ExitStatus } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { type AcpProfiles, builtinAcpProfiles } from "../agents/index.js";
import {
  type AcpProfile,
  AcpSession,
  firstPromptBlocks,
  type McpServerConfig,
  permissionOutcome,
  type PromptBlock,
  sessionMeta,
  type SessionSetup
} from "../domain/acp-session/index.js";
import { readClientFile, sessionRoot, writeClientFile } from "./client-fs.js";
import {
  type ConnectionState,
  connectionClosed,
  type LiveSession,
  type LoadFailure,
  markClosed,
  type PermissionCallback,
  requestError,
  shutdown,
  step
} from "./connection.js";
import {
  type AcpRequestFailed,
  type AcpTimeout,
  type AgentUnavailable,
  type AuthMethodInfo,
  type AuthRequired,
  type BindingNotFound,
  capabilityUnsupported,
  type ConnectionClosed,
  type HandshakeFailed,
  invalidOption,
  type LoadUnsupported
} from "./errors.js";
import { type AcpSessionHandle, answerPermission, deliverUpdate, sessionHandle } from "./live-session.js";
import {
  type AcpPlatform,
  SessionBindingStore,
  type SessionBindingStoreFailure,
  type SessionBindingStoreShape
} from "./ports.js";
import {
  type AcpWire,
  type AgentFeatures,
  type AgentInfo,
  ClientFileError,
  openWire,
  PROTOCOL_VERSION,
  type WireFailure
} from "./wire.js";

export interface ConnectAgentOptions {
  /** The agent's working directory, and the directory of sessions that name none. */
  readonly cwd: string;
  /** The agent's complete environment; nothing is inherited. `agentEnv` picks what a profile lists from another one. */
  readonly env: Env;
  /** Answers permission requests; without it, or without an answer, every request is denied. */
  readonly onPermission?: PermissionCallback;
  /** MCP servers of every session that names none. */
  readonly mcpServers?: readonly McpServerConfig[];
  /**
   * Offers the agent client file reads or writes, limited to each session's directory after links are resolved.
   * Off by default: agents read and write files themselves.
   */
  readonly fileSystem?: { readonly read?: boolean; readonly write?: boolean };
  /** Profiles that replace or add to `builtinAcpProfiles` for this call. */
  readonly profiles?: AcpProfiles;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /** How long the agent may take to start and answer `initialize`; 30 s by default. */
  readonly handshakeTimeoutMs?: number;
  /** How long `session/new`, `session/load` and `session/resume` may take; 30 s by default. */
  readonly requestTimeoutMs?: number;
  /** How long a cancel may take, from sending `session/cancel` to the end of the turn; 5 s by default. */
  readonly cancelTimeoutMs?: number;
}

export interface SessionOptions extends SessionSetup {
  /** The session's directory; the connection's `cwd` by default. */
  readonly cwd?: string;
  /** The connection's `mcpServers` by default. */
  readonly mcpServers?: readonly McpServerConfig[];
}

export interface NewSessionOptions extends SessionOptions {
  /** Binds this key to the new session in the `SessionBindingStore`, so a later connection can load it. */
  readonly sessionKey?: string;
}

/** The session to open: the one bound to a key, or one by id, optionally binding a key to it. */
export type LoadSessionTarget =
  | { readonly sessionKey: string }
  | { readonly sessionId: string; readonly sessionKey?: string };

export type ConnectError = AgentUnavailable | HandshakeFailed;

export type NewSessionError =
  | ConnectionClosed
  | AuthRequired
  | AcpRequestFailed
  | AcpTimeout
  | SessionBindingStoreFailure;

export type LoadSessionError = NewSessionError | LoadUnsupported | BindingNotFound;

/** A running ACP agent process after the handshake. It belongs to the Scope `connectAgent` ran in. */
export interface AcpConnection {
  readonly agent: CodingAgentId;
  readonly agentInfo?: AgentInfo;
  readonly features: AgentFeatures;
  /** How the agent says one can log in; offered by agents that are logged in too, so it is not a login state. */
  readonly authMethods: readonly AuthMethodInfo[];
  /** `session/new`; fails with `AuthRequired` when the agent needs a login first. */
  newSession(options?: NewSessionOptions): Effect.Effect<AcpSessionHandle, NewSessionError>;
  /**
   * Opens an existing session with `session/load`, or `session/resume` when the agent supports only that. The agent's
   * replay of the session's history is not streamed. A session already open on this connection is returned as is.
   */
  loadSession(target: LoadSessionTarget, options?: SessionOptions): Effect.Effect<AcpSessionHandle, LoadSessionError>;
  /** Succeeds, with why, once the connection has ended. */
  readonly ended: Effect.Effect<ConnectionClosed>;
  /** Closes every session and stops the process: SIGTERM, then SIGKILL after the platform's grace period. */
  close(): Effect.Effect<void>;
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 5_000;
/** How long closing waits for the process to exit after the platform stopped it. */
const CLOSE_WAIT_MS = 10_000;
/** How long a connection whose stream closed waits for the process's exit status. */
const EXIT_STATUS_WAIT_MS = 1_000;
const STDERR_TAIL_CHARS = 8 * 1024;
const CLIENT_INFO = { name: "@rivus/agent-kit", version: "1" } as const;

/**
 * Starts `agent`'s ACP program with exactly `options.env` and completes the ACP handshake. The connection belongs to
 * the caller's Scope: closing that Scope closes every session and stops the process. Throws an `AgentKitError` (as a
 * defect) for an agent without a profile or an option out of range.
 */
export function connectAgent(
  agent: CodingAgentId,
  options: ConnectAgentOptions
): Effect.Effect<AcpConnection, ConnectError, PlatformService | Scope.Scope> {
  return Effect.gen(function* () {
    const profile = yield* Effect.sync(() => profileOf(agent, options.profiles));
    const timeouts = yield* Effect.sync(() => timeoutsOf(options));
    const platform = yield* PlatformService;
    const bindings = yield* Effect.serviceOption(SessionBindingStore);
    const scope = yield* Scope.fork(yield* Effect.scope, "sequential");
    return yield* open(agent, profile, options, timeouts, platform, bindings, scope).pipe(
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : Scope.close(scope, exit)))
    );
  });
}

function profileOf(agent: CodingAgentId, profiles: AcpProfiles | undefined): AcpProfile {
  const profile = profiles?.[agent] ?? builtinAcpProfiles[agent];
  if (profile === undefined) {
    throw capabilityUnsupported(agent);
  }
  return profile;
}

interface Timeouts {
  readonly handshakeTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly cancelTimeoutMs: number;
}

function timeoutsOf(options: ConnectAgentOptions): Timeouts {
  const timeouts = {
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    cancelTimeoutMs: options.cancelTimeoutMs ?? DEFAULT_CANCEL_TIMEOUT_MS
  };
  for (const [name, value] of Object.entries(timeouts)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw invalidOption(`${name} must be a positive number of milliseconds, got ${value}`);
    }
  }
  return timeouts;
}

function open(
  agent: CodingAgentId,
  profile: AcpProfile,
  options: ConnectAgentOptions,
  timeouts: Timeouts,
  platform: AcpPlatform,
  bindings: Option.Option<SessionBindingStoreShape>,
  scope: Scope.Closeable
): Effect.Effect<AcpConnection, ConnectError> {
  return Effect.gen(function* () {
    const unavailable = (cause: unknown): AgentUnavailable => ({
      _tag: "AgentUnavailable",
      agent,
      command: profile.command,
      message: cause instanceof Error ? cause.message : String(cause)
    });
    const controller = new AbortController();
    let conn: ConnectionState | undefined;
    let wire: AcpWire | undefined;
    let exitStatus: ExitStatus | undefined;
    // Spawning and registering the finalizer that stops the process form one step, so the process is never unowned.
    const { child, exited } = yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const spawned = yield* Effect.try({
          try: () =>
            platform.process.spawn(profile.command, profile.args, {
              cwd: options.cwd,
              env: options.env,
              signal: controller.signal
            }),
          catch: unavailable
        });
        const settled: Promise<ExitStatus | Error> = spawned.exited.then(
          (status) => {
            exitStatus = status;
            return status;
          },
          (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
        );
        yield* Scope.addFinalizer(
          scope,
          Effect.suspend(() => {
            if (conn === undefined) {
              wire?.close();
              controller.abort();
            } else {
              shutdown(conn, "closed");
            }
            return Effect.promise(() => settled).pipe(Effect.timeoutOption(CLOSE_WAIT_MS));
          })
        );
        return { child: spawned, exited: settled };
      })
    );
    const stderr = drainTail(child.stderr);
    const fileSystem = { read: options.fileSystem?.read === true, write: options.fileSystem?.write === true };

    const rootOf = (sessionId: string) => {
      const root = conn?.sessions.get(sessionId)?.root;
      if (root === undefined) {
        throw new ClientFileError("refused", `session ${sessionId} has no directory for client file calls`);
      }
      return root;
    };
    const opened = openWire(child, options.clientInfo?.name ?? CLIENT_INFO.name, {
      onUpdate: (sessionId, update) => {
        const live = conn?.sessions.get(sessionId);
        if (conn !== undefined && live !== undefined) {
          deliverUpdate(conn, live, update);
        }
      },
      onPermission: (request, signal) =>
        conn === undefined
          ? Promise.resolve(permissionOutcome(request, undefined, false))
          : answerPermission(conn, request, signal),
      ...(fileSystem.read
        ? { readTextFile: (request) => readClientFile(platform.fs, rootOf(request.sessionId), request) }
        : {}),
      ...(fileSystem.write
        ? { writeTextFile: (request) => writeClientFile(platform.fs, rootOf(request.sessionId), request) }
        : {})
    });
    wire = opened;

    const handshakeFailed = (reason: HandshakeFailed["reason"], message: string): HandshakeFailed => {
      const tail = stderr();
      return {
        _tag: "HandshakeFailed",
        agent,
        reason,
        message,
        ...(exitStatus === undefined ? {} : { exit: exitStatus }),
        ...(tail ? { stderr: tail } : {})
      };
    };
    const ended = Effect.promise(() => exited).pipe(
      Effect.flatMap((result) =>
        Effect.fail(
          result instanceof Error
            ? unavailable(result)
            : handshakeFailed("exited", "the agent exited before completing the handshake")
        )
      )
    );
    const handshake = yield* Effect.raceFirst(
      opened
        .initialize(options.clientInfo ?? CLIENT_INFO, fileSystem)
        .pipe(
          Effect.catch((failure) =>
            failure.kind === "closed" ? ended : Effect.fail(handshakeFailed("error", failure.message))
          )
        ),
      ended
    ).pipe(
      Effect.timeoutOrElse({
        duration: timeouts.handshakeTimeoutMs,
        orElse: () =>
          Effect.fail(handshakeFailed("timeout", `initialize took longer than ${timeouts.handshakeTimeoutMs} ms`))
      })
    );
    if (handshake.protocolVersion !== PROTOCOL_VERSION) {
      return yield* Effect.fail(
        handshakeFailed(
          "protocol-version",
          `the agent speaks ACP version ${handshake.protocolVersion}, this client ${PROTOCOL_VERSION}`
        )
      );
    }

    const runPromise = yield* FiberSet.makeRuntimePromise<never>().pipe(Scope.provide(scope));
    const state: ConnectionState = {
      agent,
      profile,
      platform,
      cwd: options.cwd,
      wire: opened,
      bindings,
      sessions: new Map(),
      loading: new Map(),
      features: handshake.features,
      authMethods: handshake.authMethods,
      ...(options.onPermission === undefined ? {} : { onPermission: options.onPermission }),
      fileSystem,
      requestTimeoutMs: timeouts.requestTimeoutMs,
      cancelTimeoutMs: timeouts.cancelTimeoutMs,
      scope,
      ended: Deferred.makeUnsafe(),
      kill: () => controller.abort(),
      stderr,
      exit: () => exitStatus,
      runPromise
    };
    conn = state;
    // The process exit carries the exit status; a stream that closes first waits a little for it.
    yield* Effect.promise(() => exited).pipe(
      Effect.flatMap(() => Effect.sync(() => markClosed(state, connectionClosed(state, "exited")))),
      Effect.forkIn(scope)
    );
    yield* Effect.promise(() => opened.closed).pipe(
      Effect.andThen(Effect.promise(() => exited).pipe(Effect.timeoutOption(EXIT_STATUS_WAIT_MS))),
      Effect.flatMap(() => Effect.sync(() => markClosed(state, connectionClosed(state, "exited")))),
      Effect.forkIn(scope)
    );

    // Registered last, so it runs first when the Scope closes: from then on new requests fail with ConnectionClosed.
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => markClosed(state, connectionClosed(state, "closed")))
    );

    return {
      agent,
      ...(handshake.agentInfo === undefined ? {} : { agentInfo: handshake.agentInfo }),
      features: handshake.features,
      authMethods: handshake.authMethods,
      newSession: (sessionOptions) => newSession(state, options, sessionOptions ?? {}),
      loadSession: (target, sessionOptions) => loadSession(state, options, target, sessionOptions ?? {}),
      ended: Deferred.await(state.ended),
      close: () => Scope.close(scope, Exit.void)
    } satisfies AcpConnection;
  });
}

function newSession(
  conn: ConnectionState,
  defaults: ConnectAgentOptions,
  options: NewSessionOptions
): Effect.Effect<AcpSessionHandle, NewSessionError> {
  return Effect.gen(function* () {
    const { sessionKey } = options;
    const store = sessionKey === undefined ? undefined : yield* storeFor(conn, sessionKey);
    const cwd = options.cwd ?? conn.cwd;
    const sessionId = yield* request(
      conn,
      "session/new",
      conn.wire.newSession({
        cwd,
        mcpServers: options.mcpServers ?? defaults.mcpServers ?? [],
        ...metaOf(conn.profile, options)
      })
    );
    const live = yield* register(
      conn,
      "session/new",
      sessionId,
      cwd,
      sessionKey,
      firstPromptBlocks(conn.profile, [], options)
    );
    if (store !== undefined && sessionKey !== undefined) {
      yield* store
        .set({ sessionKey, agent: conn.agent, sessionId, cwd })
        .pipe(Effect.tapError(() => Effect.sync(() => forget(conn, live))));
    }
    return sessionHandle(conn, live);
  });
}

function loadSession(
  conn: ConnectionState,
  defaults: ConnectAgentOptions,
  target: LoadSessionTarget,
  options: SessionOptions
): Effect.Effect<AcpSessionHandle, LoadSessionError> {
  return Effect.gen(function* () {
    const { sessionKey } = target;
    const store = sessionKey === undefined ? undefined : yield* storeFor(conn, sessionKey);
    let sessionId: string;
    let boundCwd: string | undefined;
    if ("sessionId" in target) {
      sessionId = target.sessionId;
    } else {
      const binding = yield* store?.get(target.sessionKey) ?? Effect.succeed(undefined);
      if (binding === undefined || binding.agent !== conn.agent) {
        return yield* Effect.fail<BindingNotFound>({
          _tag: "BindingNotFound",
          agent: conn.agent,
          sessionKey: target.sessionKey
        });
      }
      sessionId = binding.sessionId;
      boundCwd = binding.cwd;
    }
    const live = yield* openLoaded(conn, defaults, sessionId, sessionKey, {
      ...options,
      cwd: options.cwd ?? boundCwd ?? conn.cwd
    });
    if (store !== undefined && sessionKey !== undefined) {
      // A session that is already open on this connection is shared, so a failed write keeps it open.
      if ("sessionId" in target) {
        yield* store.set({ sessionKey, agent: conn.agent, sessionId, cwd: live.cwd });
      }
      live.keys.add(sessionKey);
    }
    return sessionHandle(conn, live, sessionKey);
  });
}

/**
 * The open session with this id: the one already on the connection, the one a concurrent call is loading, or one
 * loaded now. The load runs in the connection's Scope, so a caller that stops waiting does not fail the others.
 */
function openLoaded(
  conn: ConnectionState,
  defaults: ConnectAgentOptions,
  sessionId: string,
  sessionKey: string | undefined,
  options: SessionOptions & { readonly cwd: string }
): Effect.Effect<LiveSession, LoadFailure | LoadUnsupported> {
  return Effect.suspend((): Effect.Effect<LiveSession, LoadFailure | LoadUnsupported> => {
    const existing = conn.sessions.get(sessionId);
    if (existing !== undefined && existing.session.toSnapshot().state !== "closed") {
      return Effect.succeed(existing);
    }
    const loading = conn.loading.get(sessionId);
    if (loading !== undefined) {
      return Deferred.await(loading);
    }
    if (conn.closed !== undefined) {
      return Effect.fail(conn.closed);
    }
    const method = conn.features.loadSession
      ? "session/load"
      : conn.features.resumeSession
        ? "session/resume"
        : undefined;
    if (method === undefined) {
      return Effect.fail<LoadUnsupported>({ _tag: "LoadUnsupported", agent: conn.agent, sessionId });
    }
    const done = Deferred.makeUnsafe<LiveSession, LoadFailure>();
    conn.loading.set(sessionId, done);
    const load = request(
      conn,
      method,
      conn.wire.loadSession(method, sessionId, {
        cwd: options.cwd,
        mcpServers: options.mcpServers ?? defaults.mcpServers ?? [],
        ...metaOf(conn.profile, options)
      })
    ).pipe(Effect.andThen(register(conn, method, sessionId, options.cwd, sessionKey, [])));
    // An observer of the fiber settles the shared result however the fiber ends, also when a closing Scope interrupts
    // it before it runs.
    return load.pipe(
      Effect.forkIn(conn.scope),
      Effect.flatMap((fiber) =>
        Effect.sync(() =>
          fiber.addObserver((exit) => {
            conn.loading.delete(sessionId);
            const interrupted = Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);
            Deferred.doneUnsafe(
              done,
              interrupted ? Effect.fail(conn.closed ?? connectionClosed(conn, "closed")) : exit
            );
          })
        )
      ),
      Effect.andThen(Deferred.await(done))
    );
  });
}

function metaOf(profile: AcpProfile, setup: SessionSetup): { meta?: Record<string, unknown> } {
  const meta = sessionMeta(profile, setup);
  return meta === undefined ? {} : { meta };
}

/** A session request bounded by the connection's request timeout. */
function request<A>(
  conn: ConnectionState,
  method: string,
  effect: Effect.Effect<A, WireFailure>
): Effect.Effect<A, ConnectionClosed | AuthRequired | AcpRequestFailed | AcpTimeout> {
  return Effect.suspend(() => (conn.closed === undefined ? effect : Effect.fail<WireFailure>({ kind: "closed" }))).pipe(
    Effect.mapError((failure) => requestError(conn, method, failure)),
    Effect.timeoutOrElse({
      duration: conn.requestTimeoutMs,
      orElse: () => Effect.fail<AcpTimeout>({ _tag: "AcpTimeout", method, timeoutMs: conn.requestTimeoutMs })
    })
  );
}

function storeFor(
  conn: ConnectionState,
  sessionKey: string
): Effect.Effect<SessionBindingStoreShape, SessionBindingStoreFailure> {
  if (sessionKey === "") {
    return Effect.die(invalidOption("sessionKey must not be empty"));
  }
  return Option.isSome(conn.bindings)
    ? Effect.succeed(conn.bindings.value)
    : Effect.fail({
        _tag: "SessionBindingStoreFailure",
        sessionKey,
        reason: "unavailable",
        message: "no SessionBindingStore is provided, so a sessionKey cannot be bound or loaded"
      });
}

/** Adds an opened session to the connection; its directory is resolved only when client file calls are on. */
function register(
  conn: ConnectionState,
  method: string,
  sessionId: string,
  cwd: string,
  sessionKey: string | undefined,
  pendingBlocks: readonly PromptBlock[]
): Effect.Effect<LiveSession, ConnectionClosed | AcpRequestFailed> {
  return Effect.gen(function* () {
    const root =
      conn.fileSystem.read || conn.fileSystem.write
        ? yield* Effect.promise(() => sessionRoot(conn.platform.fs, cwd).catch(() => undefined))
        : undefined;
    if (conn.closed !== undefined) {
      return yield* Effect.fail(conn.closed);
    }
    const created = AcpSession.create({ agent: conn.agent, ...(sessionKey === undefined ? {} : { sessionKey }) });
    if (!created.ok) {
      return yield* Effect.die(invalidOption(created.error.message));
    }
    const opened = created.value.opened(sessionId);
    if (!opened.ok) {
      return yield* Effect.fail<AcpRequestFailed>({
        _tag: "AcpRequestFailed",
        method,
        message: `the agent named an invalid session id "${sessionId}"`
      });
    }
    const live: LiveSession = {
      sessionId,
      cwd,
      keys: new Set(sessionKey === undefined ? [] : [sessionKey]),
      session: opened.value.state,
      pendingBlocks,
      ...(root === undefined ? {} : { root })
    };
    conn.sessions.set(sessionId, live);
    return live;
  });
}

/** Drops a session whose binding could not be written; the agent keeps it, the caller never got a handle. */
function forget(conn: ConnectionState, live: LiveSession): void {
  step(live, { ok: true, value: live.session.close("closed") });
  conn.sessions.delete(live.sessionId);
}

/** Reads a stream to its end, keeping its last characters, so a chatty agent never blocks on a full pipe. */
function drainTail(stream: ReadableStream<Uint8Array>): () => string {
  let tail = "";
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const read = (): Promise<void> =>
    reader.read().then(({ done, value }) => {
      if (!done) {
        tail = `${tail}${decoder.decode(value, { stream: true })}`.slice(-STDERR_TAIL_CHARS);
        return read();
      }
      return undefined;
    });
  read().catch(() => undefined);
  return () => tail.trim();
}
