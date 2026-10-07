import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { AuthState } from "./auth-state.js";
import type { DetectionStatus } from "./detection-status.js";
import type { Evidence } from "./evidence.js";
import type { InstallationKind } from "./probe-recipe.js";
import type { ProbeProblem } from "./probe-problem.js";
import type { Version } from "./version.js";

/** What detection found out about one agent on this machine. */
export interface Installation {
  readonly agent: CodingAgentId;
  readonly displayName: string;
  readonly kind: InstallationKind;
  readonly status: DetectionStatus;
  /** The resolved path of the agent's command on `PATH`. */
  readonly command?: string;
  /** The first application path that exists. */
  readonly appPath?: string;
  readonly version?: Version;
  readonly auth: AuthState;
  /** Every observation behind `status`, in probe order: command, version, application, configuration, MCP. */
  readonly evidence: readonly Evidence[];
  /** Checks that could not complete. */
  readonly problems: readonly ProbeProblem[];
  /** The recipe's caveats about its own facts, and caveats about this run, such as a Windows shim it did not run. */
  readonly warnings: readonly string[];
}
