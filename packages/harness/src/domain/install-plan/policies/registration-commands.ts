import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { PlanStep } from "../value-objects/plan-step.js";

export type RegistrationPurpose = "register" | "unregister";

export interface RegistrationCommands {
  /** The agent whose command line acts: the step's first, falling back to the ledger entry's first. */
  readonly agent: CodingAgentId;
  /** What the command line does, in order: an outdated registration is unregistered first. */
  readonly purposes: readonly RegistrationPurpose[];
}

/**
 * What one cli-registration step means for the agent's command line. A `restore-pre-image` removal means the
 * registration existed before harness adopted it, so nothing runs on the command line (`undefined`). Any other
 * removal unregisters; a write whose precondition carries a hash (the registration is there with other content)
 * unregisters and registers anew, so the agent copies again; anything else registers. Also `undefined` when no agent
 * can run a command line for it.
 */
export function registrationCommands(step: PlanStep, entry: LedgerEntry | undefined): RegistrationCommands | undefined {
  if (step.locator.kind !== "cli-registration") {
    return undefined;
  }
  if (step.action === "remove" && step.removal === "restore-pre-image") {
    return undefined;
  }
  const agent = step.agents[0] ?? entry?.agents[0];
  if (agent === undefined) {
    return undefined;
  }
  if (step.action === "remove") {
    return { agent, purposes: ["unregister"] };
  }
  return { agent, purposes: "hash" in step.precondition ? ["unregister", "register"] : ["register"] };
}
