import type {
  PermissionDecision,
  PermissionOptionKind,
  PermissionOutcome,
  PermissionRequest
} from "../value-objects/permission-request.js";

/** The request's first option of `kind` as a decision, such as `optionOfKind(request, "allow_once")`. */
export function optionOfKind(
  request: PermissionRequest,
  kind: PermissionOptionKind
): { readonly optionId: string } | undefined {
  const option = request.options.find((candidate) => candidate.kind === kind);
  return option === undefined ? undefined : { optionId: option.optionId };
}

/**
 * The answer the agent receives. While the turn is cancelling every request is `cancelled`, as ACP requires. A
 * decision for an option the request offered selects it, and an explicit `cancelled` answer reaches the agent as
 * the cancelled outcome; anything else denies: the request's reject option, or `cancelled` when it offers none.
 */
export function permissionOutcome(
  request: PermissionRequest,
  decision: PermissionDecision | undefined,
  cancelling: boolean
): PermissionOutcome {
  if (cancelling) {
    return { outcome: "cancelled" };
  }
  if (decision !== undefined) {
    // An explicit cancelled outcome takes precedence over any option id the
    // answer may still carry, such as one spread from an earlier allow: the
    // agent must read a cancellation as one, never as the approval it names.
    const outcome: string | undefined = "outcome" in decision ? decision.outcome : undefined;
    if (outcome === "cancelled") {
      return { outcome: "cancelled" };
    }
    // An option the request offered selects it, even when the answer arrived
    // in ACP's own selected shape (`{ outcome: "selected", optionId }`, which
    // structurally fits the option-id arm); the outcome is read as a plain
    // string, since an answer shaped by the agent's dialect may name another
    // outcome at run time.
    const optionId = "optionId" in decision ? decision.optionId : undefined;
    if (optionId !== undefined && request.options.some((option) => option.optionId === optionId)) {
      return { outcome: "selected", optionId };
    }
  }
  const reject = optionOfKind(request, "reject_once") ?? optionOfKind(request, "reject_always");
  return reject === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId: reject.optionId };
}
