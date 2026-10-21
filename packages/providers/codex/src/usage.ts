import { CODEX_ID } from "./facts.js";
import { CODEX_SESSION_FILES, codexRoots, codexSessionStem, codexUsageSourceId } from "./layout.js";
import { codexUsageKey, codexUsageLines } from "./records/usage.js";
import {
  type UsageDecoder,
  decodeJsonlUsage,
  fileSources,
  type JsonlUsageLayout,
  sameFile
} from "@rivus/agent-kit-sessions/spi";

const AGENT = CODEX_ID;

const layout: JsonlUsageLayout = {
  agent: AGENT,
  file: sameFile((path) => ({ sessionId: codexSessionStem(path) })),
  decoder: codexUsageLines
};

/** Every rollout under `<home>/sessions` and `<home>/archived_sessions`; a fork or subagent is a source of its own. */
export const codexUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: codexUsageKey,
  sources(platform, home, options = {}) {
    return fileSources(platform, AGENT, codexRoots(home), CODEX_SESSION_FILES, {
      ...options,
      identify: codexUsageSourceId
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};

export { codexUsage } from "./records/usage.js";
