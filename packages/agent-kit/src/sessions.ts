import { listSessions as contextListSessions } from "@rivus/agent-kit-sessions/public";
import { sessionAdapterHome as contextSessionAdapterHome } from "@rivus/agent-kit-sessions/public";
import { sessionsTable } from "./providers/sessions.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions, Provider } from "./providers/types.js";

export { builtinSessionAdapters, isSessionHead } from "@rivus/agent-kit-sessions/public";
export type {
  DiscoverOptions,
  LoadOptions,
  ReadFailed,
  SessionAdapter,
  SessionAdapters,
  SessionErrorCode,
  SessionHead,
  SessionListError,
  SessionListFailure,
  SessionNotFound,
  SessionPlatform,
  SessionReadError,
  SessionRef
} from "@rivus/agent-kit-sessions/public";

export type ListSessionsOptions = ProviderOptions<Parameters<typeof contextListSessions>[1]>;

export function listSessions(
  platform: Parameters<typeof contextListSessions>[0],
  options: ListSessionsOptions = {}
): ReturnType<typeof contextListSessions> {
  return contextListSessions(platform, {
    ...options,
    providers: { sessions: sessionsTable(options.providers), identity: identityTable(options.providers) }
  });
}

export function sessionAdapterHome(
  adapter: Parameters<typeof contextSessionAdapterHome>[0],
  context: Parameters<typeof contextSessionAdapterHome>[1],
  options: { readonly providers?: readonly Provider[] } = {}
): ReturnType<typeof contextSessionAdapterHome> {
  return contextSessionAdapterHome(adapter, context, identityTable(options.providers));
}
