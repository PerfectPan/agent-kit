import {
  CODEX_SESSION_FILES,
  codexRoots,
  codexSessionStem,
  codexUsageKey,
  codexUsageLines
} from "../../agents/codex/index.js";
import { basenamePath } from "../../domain/session/index.js";
import type { UsageDecoder } from "../usage-ports.js";
import { decodeJsonlUsage, fileSources, type JsonlUsageLayout, sameFile } from "./files.js";

const AGENT = "codex";

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
    // Archiving moves a rollout from `sessions/` to `archived_sessions/` under the same name.
    return fileSources(platform, AGENT, codexRoots(home), CODEX_SESSION_FILES, { ...options, identify: basenamePath });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};
