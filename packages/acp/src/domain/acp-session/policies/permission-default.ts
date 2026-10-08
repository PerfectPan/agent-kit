import type {
  PermissionDecision,
  PermissionOptionKind,
  PermissionOutcome,
  PermissionRequest
} from "../value-objects/permission-request.js";

/**
 * The answer the agent receives. While the turn is cancelling every request is `cancelled`, as ACP requires. A
 * decision for an option the request offered selects it; anything else denies: the request's reject option, or
 * `cancelled` when it offers none.
 */
export function permissionOutcome(
  request: PermissionRequest,
  decision: PermissionDecision | undefined,
  cancelling: boolean
): PermissionOutcome {
  if (cancelling) {
    return { outcome: "cancelled" };
  }
  if (decision !== undefined && request.options.some((option) => option.optionId === decision.optionId)) {
    return { outcome: "selected", optionId: decision.optionId };
  }
  const reject = optionOfKind(request, "reject_once") ?? optionOfKind(request, "reject_always");
  return reject === undefined ? { outcome: "cancelled" } : { outcome: "selected", optionId: reject.optionId };
}

/** The request's first option of `kind` as a decision, such as `optionOfKind(request, "allow_once")`. */
export function optionOfKind(request: PermissionRequest, kind: PermissionOptionKind): PermissionDecision | undefined {
  const option = request.options.find((candidate) => candidate.kind === kind);
  return option === undefined ? undefined : { optionId: option.optionId };
}
