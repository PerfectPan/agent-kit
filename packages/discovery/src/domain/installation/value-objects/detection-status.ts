/**
 * How present an agent is: `runnable` when its command ran its version probe successfully, `found` when something of
 * it exists but running it is not proven, `missing` when every check completed and found nothing, and `unknown` when
 * nothing was found but a check could not complete.
 */
export type DetectionStatus = "runnable" | "found" | "missing" | "unknown";

export const DETECTION_STATUSES: readonly DetectionStatus[] = ["runnable", "found", "missing", "unknown"];
