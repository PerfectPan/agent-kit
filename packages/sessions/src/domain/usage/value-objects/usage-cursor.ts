import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { UsageRecord } from "./usage-record.js";

/**
 * Where a decode of one source stopped, as plain JSON data. Passed back as `from`, it continues there without reading
 * the source again: the next decode yields only what was written since. It belongs to the source it came from.
 */
export interface UsageCursor {
  readonly agent: CodingAgentId;
  /** Bytes read from the start of the file; 0 for a database or a directory. */
  readonly offset: number;
  /** Lines read; 0 for a database or a directory. */
  readonly line: number;
  /**
   * What the agent's rules keep between records, such as Codex's cumulative totals, the Claude Code requests that may
   * still get records, or a database's position.
   */
  readonly state?: unknown;
  /** Records decoded but not yet yielded when the loop was left. */
  readonly queue?: readonly UsageRecord[];
}
