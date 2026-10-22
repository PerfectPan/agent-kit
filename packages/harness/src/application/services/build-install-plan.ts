import {
  buildInstallPlan as build,
  type PlanRequest as DomainRequest
} from "../../domain/install-plan/factories/build-install-plan.js";
import type { Ledger } from "../../domain/ledger/aggregates/ledger.js";
import type { ObservedArtifact } from "../../domain/install-plan/spi/observed-artifact.js";
import { legacyTexts } from "./legacy-artifact.js";

export type PlanRequest = Omit<DomainRequest, "legacyTexts">;

/** The plain-data SPI entry validates legacy command content before passing evidence into the domain factory. */
export function buildInstallPlan(
  request: PlanRequest,
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): ReturnType<typeof build> {
  return build({ ...request, legacyTexts: legacyTexts(observed) }, ledger, observed);
}
