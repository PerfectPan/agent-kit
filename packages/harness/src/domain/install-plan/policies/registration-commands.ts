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
 * What one cli-registration step means for the agent's command line. A removal unregisters, unless it is a
 * `restore-pre-image`, which leaves the registration harness adopted in place and runs nothing (empty `purposes`). A
 * write whose precondition carries a hash (the registration is there with other content) unregisters and registers
 * anew, so the agent copies again; anything else registers. `undefined` only means no agent can run a command line
 * for the step.
 *
 * Callers pass only steps that change something on disk (`touchesDisk`): a `release` or `keep` removal changes the
 * ledger alone, and this rule answers only for a command line something actually runs.
 */
export function registrationCommands(step: PlanStep, entry: LedgerEntry | undefined): RegistrationCommands | undefined {
  if (step.locator.kind !== "cli-registration") {
    return undefined;
  }
  const agent = step.agents[0] ?? entry?.agents[0];
  if (agent === undefined) {
    return undefined;
  }
  if (step.action === "remove") {
    return { agent, purposes: step.removal === "restore-pre-image" ? [] : ["unregister"] };
  }
  return { agent, purposes: "hash" in step.precondition ? ["unregister", "register"] : ["register"] };
}
