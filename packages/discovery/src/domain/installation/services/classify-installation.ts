import type { DetectionStatus } from "../value-objects/detection-status.js";
import type { Evidence } from "../value-objects/evidence.js";
import type { ProbeProblem } from "../value-objects/probe-problem.js";

/**
 * The status that evidence supports, independent of its order. A successful version probe makes an agent
 * `runnable`; any other evidence makes it `found`; with no evidence it is `missing` only when every check completed,
 * and `unknown` otherwise.
 */
export function classifyInstallation(
  evidence: readonly Evidence[],
  problems: readonly ProbeProblem[] = []
): DetectionStatus {
  if (evidence.some((item) => item.kind === "version")) {
    return "runnable";
  }
  if (evidence.length > 0) {
    return "found";
  }
  return problems.length > 0 ? "unknown" : "missing";
}
