import {
  buildInstallPlan as build,
  type PlanRequest as DomainRequest
} from "../../domain/install-plan/factories/build-install-plan.js";
import type { Ledger } from "../../domain/ledger/aggregates/ledger.js";
import type { ObservedArtifact } from "../../domain/install-plan/spi/observed-artifact.js";
import { legacyTexts } from "./legacy-artifact.js";

export type PlanRequest = Omit<DomainRequest, "legacyTexts">;

/**
 * The plain-data SPI entry validates legacy command content before passing evidence into the domain factory.
 * `sourceMarkers` carries, per scanned find, the markers of the legacy source it came from, judged against it
 * instead of the bundle's markers when the source declares its own.
 */
export function buildInstallPlan(
  request: PlanRequest,
  ledger: Ledger,
  observed: readonly ObservedArtifact[],
  sourceMarkers: ReadonlyMap<ObservedArtifact, readonly string[]> = new Map()
): ReturnType<typeof build> {
  return build({ ...request, legacyTexts: legacyTexts(observed, sourceMarkers) }, ledger, observed);
}
