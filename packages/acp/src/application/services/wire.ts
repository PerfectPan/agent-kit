// The only module that speaks the ACP SDK. It turns SDK requests into Effects and SDK shapes into the kit's own, so
// no SDK type reaches the public surface.

import * as acp from "@agentclientprotocol/sdk";
import * as Effect from "effect/Effect";
import * as z from "zod/mini";

import type {
  McpServerConfig,
  PermissionOutcome,
  PermissionRequest,
  PromptBlock
} from "../../domain/acp-session/index.js";
import type { AuthMethodInfo } from "../errors.js";

/** Why a request failed: the agent answered with an error, or the connection ended before it answered. */
export type WireFailure =
  | { readonly kind: "rejected"; readonly code?: number; readonly message: string; readonly data?: unknown }
  | { readonly kind: "closed" };

export interface ReadTextFile {
  readonly sessionId: string;
  readonly path: string;
  readonly line?: number;
  readonly limit?: number;
}

export interface WriteTextFile {
  readonly sessionId: string;
  readonly path: string;
  readonly content: string;
}

/** A client file call the kit refused, or a file that does not exist. */
export class ClientFileError extends Error {
  readonly kind: "refused" | "not-found";

  constructor(kind: "refused" | "not-found", message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface WireHandlers {
  /** Called synchronously for every `session/update`, in the order the agent sent them. */
  readonly onUpdate: (sessionId: string, update: Record<string, unknown>) => void;
  readonly onPermission: (request: PermissionRequest, signal: AbortSignal) => Promise<PermissionOutcome>;
  readonly readTextFile?: (request: ReadTextFile) => Promise<string>;
  readonly writeTextFile?: (request: WriteTextFile) => Promise<void>;
}

export interface AgentFeatures {
  readonly loadSession: boolean;
  readonly resumeSession: boolean;
  readonly closeSession: boolean;
  readonly image: boolean;
  readonly audio: boolean;
  readonly embeddedContext: boolean;
  readonly mcpHttp: boolean;
  readonly mcpSse: boolean;
}

export interface AgentInfo {
  readonly name: string;
  readonly version: string;
  readonly title?: string;
}

export interface Handshake {
  readonly protocolVersion: number;
  readonly features: AgentFeatures;
  readonly authMethods: readonly AuthMethodInfo[];
  readonly agentInfo?: AgentInfo;
}

export interface SessionParams {
  readonly cwd: string;
  readonly mcpServers: readonly McpServerConfig[];
  readonly meta?: Record<string, unknown>;
}

/** One ACP connection over a child's stdio. */
export interface AcpWire {
  /** Whether the SDK connection has closed; requests fail with `closed` from then on. */
  readonly isClosed: () => boolean;
  readonly closed: Promise<void>;
  close(): void;
  initialize(
    clientInfo: { readonly name: string; readonly version: string },
    fileSystem: { readonly read: boolean; readonly write: boolean }
  ): Effect.Effect<Handshake, WireFailure>;
  newSession(params: SessionParams): Effect.Effect<string, WireFailure>;
  loadSession(
    method: "session/load" | "session/resume",
    sessionId: string,
    params: SessionParams
  ): Effect.Effect<void, WireFailure>;
  closeSession(sessionId: string): Effect.Effect<void, WireFailure>;
  /**
   * Sends `session/prompt` when called, so the request is on the wire before any `cancel` sent later; the Effect
   * waits for the answer. It never sends `$/cancel_request`: a prompt ends through `session/cancel` and the answer.
   */
  prompt(
    sessionId: string,
    blocks: readonly PromptBlock[]
  ): Effect.Effect<{ readonly stopReason: string; readonly usage?: unknown }, WireFailure>;
  cancel(sessionId: string): Effect.Effect<void>;
}

/** The ACP protocol version this client speaks. */
export const PROTOCOL_VERSION: number = acp.PROTOCOL_VERSION;

/** JSON-RPC code for "log in first" in ACP. */
const AUTH_REQUIRED = -32000;

export function isAuthRequired(failure: WireFailure): boolean {
  return (
    failure.kind === "rejected" && (failure.code === AUTH_REQUIRED || /auth[\s_-]?required/i.test(failure.message))
  );
}

const SessionUpdate = z.object({
  sessionId: z.string(),
  update: z.looseObject({ sessionUpdate: z.string() })
});

/**
 * Opens a connection whose `session/update` notifications go to `handlers.onUpdate` as they come off the wire,
 * before the SDK reads the next message. The SDK dispatches notifications and responses on different microtask paths,
 * so a turn reading updates through it could see the prompt's answer before the turn's last update.
 */
export function openWire(
  io: { readonly stdin: WritableStream<Uint8Array>; readonly stdout: ReadableStream<Uint8Array> },
  clientName: string,
  handlers: WireHandlers
): AcpWire {
  const { writable, readable } = acp.ndJsonStream(io.stdin, io.stdout);
  const routed = readable.pipeThrough(
    new TransformStream<acp.AnyMessage, acp.AnyMessage>({
      transform(message, controller) {
        const record = message as Record<string, unknown>;
        if (record.method !== acp.methods.client.session.update || "id" in record) {
          controller.enqueue(message);
          return;
        }
        // A malformed update names no session to deliver it to; the SDK would only log it.
        const parsed = SessionUpdate.safeParse(record.params);
        if (parsed.success) {
          handlers.onUpdate(parsed.data.sessionId, parsed.data.update);
        }
      }
    })
  );

  let app = acp
    .client({ name: clientName })
    .onRequest(acp.methods.client.session.requestPermission, async ({ params, signal }) => ({
      outcome: await handlers.onPermission(permissionRequestOf(params), signal)
    }));
  const { readTextFile, writeTextFile } = handlers;
  if (readTextFile) {
    app = app.onRequest(acp.methods.client.fs.readTextFile, async ({ params }) => ({
      content: await fileCall(() =>
        readTextFile({
          sessionId: params.sessionId,
          path: params.path,
          ...(typeof params.line === "number" ? { line: params.line } : {}),
          ...(typeof params.limit === "number" ? { limit: params.limit } : {})
        })
      )
    }));
  }
  if (writeTextFile) {
    app = app.onRequest(acp.methods.client.fs.writeTextFile, async ({ params }) => {
      await fileCall(() => writeTextFile({ sessionId: params.sessionId, path: params.path, content: params.content }));
      return {};
    });
  }
  const connection = app.connect({ writable, readable: routed });

  const failure = (error: unknown): WireFailure => {
    if (connection.signal.aborted) {
      return { kind: "closed" };
    }
    if (error instanceof acp.RequestError) {
      return {
        kind: "rejected",
        code: error.code,
        message: error.message,
        ...(error.data === undefined ? {} : { data: error.data })
      };
    }
    return { kind: "rejected", message: error instanceof Error ? error.message : String(error) };
  };

  const request = <M extends acp.AgentRequestMethod>(
    method: M,
    params: acp.AgentRequestParamsByMethod[M]
  ): Effect.Effect<acp.AgentRequestResponsesByMethod[M], WireFailure> =>
    Effect.tryPromise({
      try: (signal) => connection.agent.request(method, params, { cancellationSignal: signal }),
      catch: failure
    });

  return {
    isClosed: () => connection.signal.aborted,
    closed: connection.closed,
    close: () => connection.close(),
    initialize: (clientInfo, fileSystem) =>
      request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: fileSystem.read, writeTextFile: fileSystem.write } },
        clientInfo: { name: clientInfo.name, version: clientInfo.version }
      }).pipe(Effect.map(handshakeOf)),
    newSession: (params) =>
      request(acp.methods.agent.session.new, sessionRequest(params)).pipe(Effect.map((response) => response.sessionId)),
    loadSession: (method, sessionId, params) =>
      (method === "session/load"
        ? request(acp.methods.agent.session.load, { ...sessionRequest(params), sessionId })
        : request(acp.methods.agent.session.resume, { ...sessionRequest(params), sessionId })
      ).pipe(Effect.asVoid),
    closeSession: (sessionId) => request(acp.methods.agent.session.close, { sessionId }).pipe(Effect.asVoid),
    prompt: (sessionId, blocks) => {
      const answer = connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: blocks.map(acpBlock)
      });
      // A rejection before the Effect runs must not surface as unhandled.
      answer.catch(() => undefined);
      return Effect.tryPromise({ try: () => answer, catch: failure }).pipe(
        Effect.map((response) => ({
          stopReason: response.stopReason,
          ...(response.usage == null ? {} : { usage: response.usage })
        }))
      );
    },
    cancel: (sessionId) =>
      Effect.tryPromise(() => connection.agent.notify(acp.methods.agent.session.cancel, { sessionId })).pipe(
        Effect.ignore
      )
  };
}

/** Runs a client file call; a refusal or a missing file reaches the agent as a JSON-RPC error it can read. */
async function fileCall<A>(call: () => Promise<A>): Promise<A> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ClientFileError) {
      throw error.kind === "not-found"
        ? acp.RequestError.resourceNotFound(error.message)
        : acp.RequestError.invalidParams(undefined, error.message);
    }
    throw error;
  }
}

function sessionRequest(params: SessionParams): acp.NewSessionRequest {
  return {
    cwd: params.cwd,
    mcpServers: params.mcpServers.map(acpMcpServer),
    ...(params.meta === undefined ? {} : { _meta: params.meta })
  };
}

function acpMcpServer(server: McpServerConfig): acp.McpServer {
  if ("url" in server) {
    return {
      type: server.type,
      name: server.name,
      url: server.url,
      headers: server.headers.map(({ name, value }) => ({ name, value }))
    };
  }
  return {
    name: server.name,
    command: server.command,
    args: [...server.args],
    env: server.env.map(({ name, value }) => ({ name, value }))
  };
}

function acpBlock(block: PromptBlock): acp.ContentBlock {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return { type: "image", data: block.data, mimeType: block.mimeType, ...(block.uri ? { uri: block.uri } : {}) };
    case "resource_link":
      return { ...block };
    case "resource":
      return { type: "resource", resource: { ...block.resource } };
  }
}

function handshakeOf(response: acp.InitializeResponse): Handshake {
  const capabilities = response.agentCapabilities;
  const prompt = capabilities?.promptCapabilities;
  const sessions = capabilities?.sessionCapabilities;
  const mcp = capabilities?.mcpCapabilities;
  const info = response.agentInfo;
  return {
    protocolVersion: response.protocolVersion,
    features: {
      loadSession: capabilities?.loadSession === true,
      resumeSession: sessions?.resume != null,
      closeSession: sessions?.close != null,
      image: prompt?.image === true,
      audio: prompt?.audio === true,
      embeddedContext: prompt?.embeddedContext === true,
      mcpHttp: mcp?.http === true,
      mcpSse: mcp?.sse === true
    },
    authMethods: (response.authMethods ?? []).map((method) => ({
      id: method.id,
      name: method.name,
      ...(method.description ? { description: method.description } : {})
    })),
    ...(info
      ? { agentInfo: { name: info.name, version: info.version, ...(info.title ? { title: info.title } : {}) } }
      : {})
  };
}

function permissionRequestOf(params: acp.RequestPermissionRequest): PermissionRequest {
  const { toolCall } = params;
  return {
    sessionId: params.sessionId,
    toolCall: {
      callId: toolCall.toolCallId,
      ...(toolCall.title ? { title: toolCall.title } : {}),
      ...(toolCall.kind ? { kind: toolCall.kind } : {}),
      ...(toolCall.rawInput === undefined ? {} : { rawInput: toolCall.rawInput })
    },
    options: params.options.map(({ optionId, name, kind }) => ({ optionId, name, kind }))
  };
}
