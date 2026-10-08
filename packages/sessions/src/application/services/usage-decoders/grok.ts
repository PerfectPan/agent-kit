import { err, ok } from "@rivus/agent-kit-catalog";

import {
  GROK_SESSION_FILES,
  grokRoots,
  grokSessionDir,
  grokSummaryFields,
  grokSummaryPath,
  grokUpdatesPath,
  grokUsageKey,
  grokUsageLines
} from "../../../domain/adapters/grok/index.js";
import { basenamePath } from "../../../domain/session/index.js";
import { readText } from "../files/read-file.js";
import type { UsageDecoder } from "../../usage-ports.js";
import { decodeJsonlUsage, fileSources, type JsonlUsageLayout } from "./files.js";

const AGENT = "grok";

const layout: JsonlUsageLayout = {
  agent: AGENT,
  /**
   * `updates.jsonl` of the session directory. The session id is the one `summary.json` names, else the directory's;
   * a summary of a format generation this adapter does not read ends the decode, as it ends a load.
   */
  async file(platform, target, signal) {
    const dir = grokSessionDir(target.path);
    const summaryPath = grokSummaryPath(dir);
    const info = await platform.fs.stat(summaryPath, { followSymlinks: true });
    let id: string | undefined;
    if (info?.kind === "file") {
      const text = await readText(platform, summaryPath, signal ? { signal } : {});
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        // A summary that is not JSON names no id; a load records it as skipped.
      }
      if (value !== undefined) {
        const fields = grokSummaryFields(value, { file: summaryPath, offset: 0, length: info.size, line: 1 });
        if (!fields.ok) {
          return err(fields.error);
        }
        id = fields.value.id;
      }
    }
    return ok({ path: grokUpdatesPath(target.path), sessionId: id ?? basenamePath(dir) });
  },
  decoder: grokUsageLines
};

/** Every session's `updates.jsonl` under `<home>/sessions`. A subagent's usage is part of its parent's turns. */
export const grokUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: grokUsageKey,
  sources(platform, home, options = {}) {
    return fileSources(platform, AGENT, grokRoots(home), GROK_SESSION_FILES, {
      ...options,
      identify: (path) => basenamePath(grokSessionDir(path))
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};
