import {
  CODEX_SESSION_FILES,
  codexRoots,
  codexSessionStem,
  codexUsageSourceId
} from "../../../domain/session/adapters/codex/layout.js";
import { codexUsageKey, codexUsageLines } from "../../../domain/usage/adapters/codex.js";
import type { UsageDecoder } from "../../usage-ports.js";
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
    return fileSources(platform, AGENT, codexRoots(home), CODEX_SESSION_FILES, {
      ...options,
      identify: codexUsageSourceId
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};
