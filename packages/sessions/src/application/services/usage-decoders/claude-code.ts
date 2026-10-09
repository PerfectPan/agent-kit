import { ok } from "@rivus/agent-kit-catalog";

import {
  CLAUDE_CODE_USAGE_FILES,
  claudeCodeRoots,
  claudeCodeUsageFile,
  claudeCodeUsageSourceId,
  claudeCodeUsageTarget
} from "../../../domain/session/adapters/claude-code/layout.js";
import { claudeCodeUsageKey, claudeCodeUsageLines } from "../../../domain/usage/adapters/claude-code.js";
import type { UsageDecoder } from "../../usage-ports.js";
import { decodeJsonlUsage, fileSources, type JsonlUsageLayout } from "./files.js";

const AGENT = "claude-code";

const layout: JsonlUsageLayout = {
  agent: AGENT,
  async file(_platform, target) {
    return ok({ path: target.path, ...claudeCodeUsageTarget(target.path) });
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
      identify: claudeCodeUsageSourceId
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};
