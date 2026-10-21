import { builtinSessionAdapters } from "@rivus/agent-kit-sessions/public";
import { mergeService } from "./merge.js";
import type { Provider } from "./types.js";

export const sessionsTable = (providers?: readonly Provider[]): ReturnType<typeof mergeService<"sessions">> =>
  mergeService("sessions", builtinSessionAdapters, providers);
