import { definedFields } from "@rivus/agent-kit-catalog/spi";
import { compactUsage, lenient, timeOfValue, type Usage } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

/**
 * One line of a session's `events.jsonl` (GitHub Copilot CLI 1.0.114): the record `type`, its `data`, the record
 * `id`, its `timestamp`, the `parentId` of the record it answers (`null` on `session.start`) and, off the main lane,
 * the `agentId` of the subagent lane it belongs to. A prompt a hook rewrote carries the id of the prompt it
 * replaces in `__copilotOriginatingMessageId`.
 */
export interface CopilotRecord {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly id?: string;
  readonly timestamp?: string | number;
  readonly parentId?: string | null;
  readonly agentId?: string;
  readonly checkpoint?: boolean;
  readonly __copilotOriginatingMessageId?: string;
}

export interface CopilotSessionStart {
  readonly sessionId?: string;
  /** The `events.jsonl` format generation. */
  readonly version?: number;
  readonly copilotVersion?: string;
  readonly startTime?: string;
  readonly cwd?: string;
}

/** What one model request was accounted as: its counts, the ids it is known by, and how long it took. */
export interface CopilotRequestUsage {
  readonly model?: string;
  readonly provider?: string;
  /** `apiCallId`, which `accounting.usageId` repeats. */
  readonly requestId?: string;
  /** `providerCallId`. */
  readonly responseId?: string;
  readonly usage?: Usage;
  readonly durationMs?: number;
  readonly finishReason?: string;
  /** How many model calls the counts cover, when the record says they sum up more than one. */
  readonly modelCalls?: number;
}

/** An `assistant.message`: its text, the reasoning the model exposed, or the fact that it stayed opaque. */
export interface CopilotAssistantMessage {
  readonly content?: string;
  readonly reasoningText?: string;
  readonly reasoningOpaque?: boolean;
  /** `apiCallId`, which names the request that produced the message. */
  readonly requestId?: string;
}

export interface CopilotToolStart {
  readonly callId?: string;
  readonly name?: string;
  readonly title?: string;
  readonly args?: unknown;
}

export interface CopilotToolEnd {
  readonly callId?: string;
  readonly success?: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly exitCode?: number;
}

export interface CopilotCompaction {
  /** `threshold` or `manual`. */
  readonly trigger?: string;
  readonly success?: boolean;
  readonly preTokens?: number;
  readonly postTokens?: number;
  readonly summary?: string;
  /** `compactionAttemptId`. */
  readonly attemptId?: string;
  /** `requestId`, the provider's id of the summarizer call. */
  readonly responseId?: string;
  /** The summarizer's own model request, from `compactionTokensUsed` and `attemptMetrics`. */
  readonly tokens?: CopilotRequestUsage;
}

export interface CopilotUserMessage {
  readonly content?: string;
  readonly source?: string;
  readonly isAutopilotContinuation?: boolean;
  readonly hasAttachments: boolean;
  readonly hasSubmittedTask: boolean;
}

export interface CopilotHookStart {
  readonly invocationId?: string;
  /** The `tool_name` of the payload a tool hook received. */
  readonly toolName?: string;
}

export interface CopilotHookEnd {
  readonly invocationId?: string;
  readonly type?: string;
  readonly error?: string;
}

/** A `subagent.started`: the `task` call that spawned the lane. Its envelope `agentId` is the new lane's id. */
export interface CopilotSubagentStart {
  readonly callId?: string;
  readonly parentId?: string;
  readonly title?: string;
}

const text = lenient(z.optional(z.string()));
const count = lenient(z.optional(z.number()));
const flag = lenient(z.optional(z.boolean()));

const CopilotEnvelope = z.looseObject({
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  id: text,
  timestamp: lenient(z.optional(z.union([z.string(), z.number()]))),
  parentId: lenient(z.nullable(z.string())),
  agentId: text,
  checkpoint: flag,
  __copilotOriginatingMessageId: text
});

/** Supported `session.start.data.version` generations (1.0.114 writes version 1). */
export function isSupportedCopilotVersion(version: number | undefined): boolean {
  return version === undefined || version === 1;
}

/** The record a line holds, or `undefined` when it is no object with a `type` and an object `data`. */
export function copilotRecordOf(value: unknown): CopilotRecord | undefined {
  return z.safeParse(CopilotEnvelope, value).data;
}

/** The record's `timestamp`, in epoch milliseconds. */
export function copilotRecordTime(record: CopilotRecord): number | undefined {
  return timeOfValue(record);
}

const CopilotContext = z.looseObject({ cwd: text });

const SessionStartData = z.looseObject({
  sessionId: text,
  version: count,
  copilotVersion: text,
  startTime: text,
  context: lenient(z.optional(CopilotContext))
});

export function copilotSessionStartOf(record: CopilotRecord): CopilotSessionStart | undefined {
  const data = z.safeParse(SessionStartData, record.data).data;
  return data === undefined
    ? undefined
    : {
        sessionId: data.sessionId,
        version: data.version,
        copilotVersion: data.copilotVersion,
        startTime: data.startTime,
        cwd: data.context?.cwd
      };
}

const SessionResumeData = z.looseObject({ context: lenient(z.optional(CopilotContext)) });

/** The working directory a `session.resume` names; the CLI can resume a session from another directory. */
export function copilotResumeCwdOf(record: CopilotRecord): string | undefined {
  return z.safeParse(SessionResumeData, record.data).data?.context?.cwd;
}

const ContentData = z.looseObject({ content: text });

/** The `content` of a `user.message`, `system.message` or `system.notification`. */
export function copilotContentOf(record: CopilotRecord): string | undefined {
  return z.safeParse(ContentData, record.data).data?.content;
}

const UserMessageData = z.looseObject({
  content: text,
  source: text,
  isAutopilotContinuation: flag,
  hasSubmittedTask: flag,
  attachments: lenient(z.optional(z.array(z.unknown())))
});

/** Parses a `user.message`, including injection flags and attachment/task-only turns. */
export function copilotUserMessageOf(record: CopilotRecord): CopilotUserMessage | undefined {
  const data = z.safeParse(UserMessageData, record.data).data;
  if (data === undefined) {
    return undefined;
  }
  return {
    content: data.content,
    source: data.source,
    isAutopilotContinuation: data.isAutopilotContinuation,
    hasAttachments: (data.attachments?.length ?? 0) > 0,
    hasSubmittedTask: data.hasSubmittedTask === true
  };
}

const SafeFileName = z.string().check(z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/));
const JournalLinkData = z.looseObject({ previousFile: lenient(z.optional(SafeFileName)) });

/** The previous rotated segment filename from `session.journal_link`, validated as a single safe filename. */
export function copilotJournalPreviousFileOf(record: CopilotRecord): string | undefined {
  return z.safeParse(JournalLinkData, record.data).data?.previousFile;
}

const TokenDetails = z.looseObject({ model: text });

const CopilotUsageData = z.looseObject({
  model: text,
  apiCallId: text,
  providerCallId: text,
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  reasoningTokens: count,
  duration: count,
  finishReason: text,
  requestCount: count,
  provider: lenient(z.optional(z.looseObject({ id: text }))),
  // `compactionTokensUsed` bills its tokens per model instead of naming one.
  behaviorModel: text,
  copilotUsage: lenient(z.optional(z.looseObject({ tokenDetails: lenient(z.optional(z.array(TokenDetails))) })))
});

function requestUsageOf(value: unknown, behaviorModel?: string): CopilotRequestUsage | undefined {
  const data = z.safeParse(CopilotUsageData, value).data;
  if (data === undefined) {
    return undefined;
  }
  const calls = data.requestCount;
  return definedFields({
    model: data.model ?? data.copilotUsage?.tokenDetails?.[0]?.model ?? behaviorModel,
    provider: data.provider?.id,
    requestId: data.apiCallId,
    responseId: data.providerCallId,
    usage: compactUsage({
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheReadTokens: data.cacheReadTokens,
      cacheWriteTokens: data.cacheWriteTokens,
      reasoningTokens: data.reasoningTokens
    }),
    durationMs: data.duration,
    finishReason: data.finishReason,
    modelCalls: calls !== undefined && calls > 1 ? calls : undefined
  });
}

const UsageRecordData = z.looseObject({ usage: lenient(z.optional(z.unknown())) });

/** What a `session.usage_record` accounted: one model request, written ahead of the message it produced. */
export function copilotUsageOf(record: CopilotRecord): CopilotRequestUsage | undefined {
  return requestUsageOf(z.safeParse(UsageRecordData, record.data).data?.usage);
}

const AssistantMessageData = z.looseObject({
  content: text,
  apiCallId: text,
  reasoningText: text,
  reasoningOpaque: text,
  encryptedContent: text,
  reasoningBlocks: lenient(z.optional(z.record(z.string(), z.unknown())))
});

export function copilotAssistantMessageOf(record: CopilotRecord): CopilotAssistantMessage | undefined {
  const data = z.safeParse(AssistantMessageData, record.data).data;
  return data === undefined
    ? undefined
    : {
        content: data.content,
        requestId: data.apiCallId,
        reasoningText: data.reasoningText,
        reasoningOpaque:
          data.reasoningOpaque !== undefined ||
          data.encryptedContent !== undefined ||
          (data.reasoningBlocks !== undefined && Object.keys(data.reasoningBlocks).length > 0)
      };
}

const ToolExecutionStartData = z.looseObject({
  toolCallId: text,
  toolName: text,
  toolTitle: text,
  arguments: lenient(z.unknown())
});

export function copilotToolStartOf(record: CopilotRecord): CopilotToolStart | undefined {
  const data = z.safeParse(ToolExecutionStartData, record.data).data;
  return data === undefined
    ? undefined
    : { callId: data.toolCallId, name: data.toolName, title: data.toolTitle, args: data.arguments };
}

const ToolError = z.looseObject({ code: text, message: text });

const ToolExecutionCompleteData = z.looseObject({
  toolCallId: text,
  success: flag,
  result: lenient(z.optional(z.looseObject({ content: lenient(z.unknown()) }))),
  error: lenient(z.optional(ToolError)),
  shellExecution: lenient(z.optional(z.looseObject({ exitCode: count })))
});

export function copilotToolEndOf(record: CopilotRecord): CopilotToolEnd | undefined {
  const data = z.safeParse(ToolExecutionCompleteData, record.data).data;
  return data === undefined
    ? undefined
    : {
        callId: data.toolCallId,
        success: data.success,
        output: data.result?.content ?? data.error?.message,
        error: data.error?.message,
        exitCode: data.shellExecution?.exitCode
      };
}

const CompactionMetrics = z.looseObject({ durationMs: count });

const CompactionCompleteData = z.looseObject({
  trigger: text,
  success: flag,
  preCompactionTokens: count,
  postCompactionTokens: count,
  summaryContent: text,
  compactionAttemptId: text,
  requestId: text,
  behaviorModelId: text,
  compactionTokensUsed: lenient(z.optional(z.unknown())),
  attemptMetrics: lenient(z.optional(CompactionMetrics))
});

export function copilotCompactionOf(record: CopilotRecord): CopilotCompaction | undefined {
  const data = z.safeParse(CompactionCompleteData, record.data).data;
  if (data === undefined) {
    return undefined;
  }
  const tokens = requestUsageOf(data.compactionTokensUsed, data.behaviorModelId);
  return {
    trigger: data.trigger,
    success: data.success,
    preTokens: data.preCompactionTokens,
    postTokens: data.postCompactionTokens,
    summary: data.summaryContent,
    attemptId: data.compactionAttemptId,
    responseId: data.requestId,
    tokens:
      tokens === undefined ? undefined : { ...tokens, durationMs: tokens.durationMs ?? data.attemptMetrics?.durationMs }
  };
}

const HookStartData = z.looseObject({
  hookInvocationId: text,
  input: lenient(z.optional(z.looseObject({ tool_name: text })))
});

export function copilotHookStartOf(record: CopilotRecord): CopilotHookStart | undefined {
  const data = z.safeParse(HookStartData, record.data).data;
  return data === undefined ? undefined : { invocationId: data.hookInvocationId, toolName: data.input?.tool_name };
}

const HookEndData = z.looseObject({
  hookInvocationId: text,
  hookType: text,
  error: lenient(z.optional(z.looseObject({ message: text })))
});

export function copilotHookEndOf(record: CopilotRecord): CopilotHookEnd | undefined {
  const data = z.safeParse(HookEndData, record.data).data;
  return data === undefined
    ? undefined
    : { invocationId: data.hookInvocationId, type: data.hookType, error: data.error?.message };
}

const SubagentStartedData = z.looseObject({
  toolCallId: text,
  parentId: text,
  agentName: text,
  agentDisplayName: text
});

export function copilotSubagentStartOf(record: CopilotRecord): CopilotSubagentStart | undefined {
  const data = z.safeParse(SubagentStartedData, record.data).data;
  return data === undefined
    ? undefined
    : { callId: data.toolCallId, parentId: data.parentId, title: data.agentDisplayName ?? data.agentName };
}

const SubagentFailedData = z.looseObject({ error: text, durationMs: count });

/** A `subagent.failed` names the error the lane ended on. */
export function copilotSubagentFailureOf(
  record: CopilotRecord
): { readonly error?: string; readonly durationMs?: number } | undefined {
  const data = z.safeParse(SubagentFailedData, record.data).data;
  return data === undefined ? undefined : { error: data.error, durationMs: data.durationMs };
}

const ReasonData = z.looseObject({ reason: text });

/** The `reason` of an `abort`. */
export function copilotAbortReasonOf(record: CopilotRecord): string | undefined {
  return z.safeParse(ReasonData, record.data).data?.reason;
}

const MessageData = z.looseObject({ message: text });

/** The `message` of a `session.error` or `session.warning`. */
export function copilotMessageOf(record: CopilotRecord): string | undefined {
  return z.safeParse(MessageData, record.data).data?.message;
}
