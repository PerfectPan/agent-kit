import { AgentKitError, type CodingAgentId } from "@rivus/agent-kit-catalog";

import type { BundleRef, InstallAdapters, InstallContext } from "../domain/bundle/index.js";
import type {
  ArtifactLocator,
  InstallPlan as PlanAggregate,
  InstallPlanSnapshot,
  PlanBasis,
  PlanStatus,
  PlanStep,
  TrustPrompt
} from "../domain/install-plan/index.js";
import type { AgentCommand, LedgerScope } from "./ports.js";

/** One file's text before and after the plan: `before` is absent for a new file, `after` for a removed one. */
export interface PlannedFileChange {
  readonly path: string;
  readonly before?: string;
  readonly after?: string;
}

/** An agent command line the plan runs, registering or removing the Artifact at `locator`. */
export interface PlannedCommand extends AgentCommand {
  readonly purpose: "register" | "unregister";
  readonly locator: ArtifactLocator;
}

/**
 * A hook an agent does not get a registration of its own for, because it runs another agent's registration of the
 * same event (Grok and Cursor run the hooks of Claude Code's settings file): it fires once, through `firedBy`.
 */
export interface DroppedHook {
  readonly agent: CodingAgentId;
  readonly firedBy: { readonly agent: CodingAgentId; readonly event: string; readonly file: string };
}

/**
 * An install plan, obtained from `planInstall` (or `uninstall`, which applies one at once) and applied once with
 * `applyInstall` or dropped with `discardPlan`. It is a read-only view: `changes` shows each file's text before and
 * after, `commands` the agent command lines to run, `expectedTrustPrompts` what the agents will ask the user. The plan
 * holds against the ledger revision it was built on; `applyInstall` refuses it once the ledger has moved on or a
 * target changed.
 */
export interface InstallPlan {
  readonly planId: string;
  readonly bundle: BundleRef;
  readonly agents: readonly CodingAgentId[];
  readonly basedOn: PlanBasis;
  /** In execution order. */
  readonly steps: readonly PlanStep[];
  readonly changes: readonly PlannedFileChange[];
  readonly commands: readonly PlannedCommand[];
  readonly expectedTrustPrompts: readonly TrustPrompt[];
  /** Steps that leave a file to a dotfiles manager or a symlink instead of deleting or restoring it. */
  readonly notes: InstallPlanSnapshot["notes"];
  readonly droppedHooks: readonly DroppedHook[];
  /** `ready` until it is applied or discarded. */
  readonly status: PlanStatus;
}

/** What the use cases keep about a plan they handed out; never visible to the caller. */
export interface PlanRecord {
  readonly scope: LedgerScope;
  readonly adapters: InstallAdapters;
  readonly context: InstallContext;
  aggregate: PlanAggregate;
}

const records = new WeakMap<InstallPlan, PlanRecord>();

export type PlanView = Omit<InstallPlan, "status">;

/** A frozen view of the plan whose `status` follows the aggregate, registered so that `applyInstall` can find it. */
export function registerPlan(view: PlanView, record: PlanRecord): InstallPlan {
  const plan: InstallPlan = Object.freeze({
    ...view,
    get status(): PlanStatus {
      return record.aggregate.status;
    }
  });
  records.set(plan, record);
  return plan;
}

/** The record behind a plan; anything but a plan from this kit is a programming error. */
export function recordOf(plan: InstallPlan): PlanRecord {
  const record = records.get(plan);
  if (record === undefined) {
    throw new AgentKitError("unknown-plan", "applyInstall takes only a plan that planInstall returned");
  }
  return record;
}
