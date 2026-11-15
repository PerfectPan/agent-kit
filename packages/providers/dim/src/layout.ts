import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { DIM_DATABASE } from "./facts.js";

// DimCode keeps its state in its home (`$DIMCODE_HOME`, default `~/.dimcode/v2`): one SQLite database holds the
// sessions, their messages and the usage ledger (`usage_ledger` is insert-only; `usage_run_stats` upserts one row
// per run). The database runs in WAL mode, so recent writes may sit in `dimcode.sqlite-wal`.

export function dimDatabasePath(home: AgentHome): string {
  return joinPath(home.path, DIM_DATABASE);
}

/** The database below the home, as a probe path names it. */
export const dimDatabaseBelowHome: string = DIM_DATABASE;
