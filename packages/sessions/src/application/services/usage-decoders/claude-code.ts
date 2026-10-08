import { ok } from "@rivus/agent-kit-catalog";

import {
  CLAUDE_CODE_USAGE_FILES,
  claudeCodeRoots,
  claudeCodeUsageFile,
  claudeCodeUsageKey,
  claudeCodeUsageLines
} from "../../../domain/adapters/claude-code/index.js";
import type { UsageDecoder } from "../../usage-ports.js";
import { belowRoot, decodeJsonlUsage, fileSources, type JsonlUsageLayout } from "./files.js";

const AGENT = "claude-code";

const layout: JsonlUsageLayout = {
  agent: AGENT,
  async file(_platform, target) {
    return ok({ path: target.path, sessionId: "unknown", ...claudeCodeUsageFile(target.path) });
  },
  decoder: claudeCodeUsageLines
};

/** Every session file under `<home>/projects`, and each session's subagent transcripts as sources of their own. */
export const claudeCodeUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: claudeCodeUsageKey,
  sources(platform, home, options = {}) {
    return fileSources(platform, AGENT, claudeCodeRoots(home), CLAUDE_CODE_USAGE_FILES, {
      ...options,
      keep: (path) => claudeCodeUsageFile(path) !== undefined,
      // Below the project directory: session ids are unique, and the project directory is named after a working
      // directory that can move.
      identify: (path, root) => {
        const below = belowRoot(path, root);
        return below.slice(below.indexOf("/") + 1);
      }
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};
