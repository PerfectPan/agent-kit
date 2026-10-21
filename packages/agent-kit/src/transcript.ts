import { loadTranscript as contextLoadTranscript } from "@rivus/agent-kit-sessions/public";
import { summarizeSession as contextSummarizeSession } from "@rivus/agent-kit-sessions/public";
import { sessionsTable } from "./providers/sessions.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions } from "./providers/types.js";

export { SESSION_SUMMARY_VERSION } from "@rivus/agent-kit-sessions/public";
export type {
  Capability,
  Lane,
  LoadTranscriptError,
  PromptSnapshotPayload,
  SessionSummary,
  SessionTarget,
  SourcePointer,
  Transcript,
  TranscriptEvent,
  TranscriptEventKind,
  TranscriptEventOf,
  TranscriptEventPayloads,
  TranscriptSession
} from "@rivus/agent-kit-sessions/public";

type LoadTranscriptOptions = ProviderOptions<Parameters<typeof contextLoadTranscript>[2]>;

export function loadTranscript(
  platform: Parameters<typeof contextLoadTranscript>[0],
  target: Parameters<typeof contextLoadTranscript>[1],
  options: LoadTranscriptOptions = {}
): ReturnType<typeof contextLoadTranscript> {
  return contextLoadTranscript(platform, target, {
    ...options,
    providers: { sessions: sessionsTable(options.providers), identity: identityTable(options.providers) }
  });
}

export function summarizeSession(
  platform: Parameters<typeof contextSummarizeSession>[0],
  target: Parameters<typeof contextSummarizeSession>[1],
  options: ProviderOptions<Parameters<typeof contextSummarizeSession>[2]> = {}
): ReturnType<typeof contextSummarizeSession> {
  return contextSummarizeSession(platform, target, {
    ...options,
    providers: { sessions: sessionsTable(options.providers), identity: identityTable(options.providers) }
  });
}
