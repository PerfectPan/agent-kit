import type { Strategy } from "../../bundle/value-objects/strategy.js";

/** From least to most invasive. */
export const STRATEGY_PREFERENCE: readonly Strategy[] = [
  "launch-injection",
  "native-plugin",
  "scan-directory",
  "shared-config"
];

/**
 * The least invasive strategy an agent supports for an Artifact. Launch-time injection counts only when the caller
 * launches the agent itself; a shared configuration edit only when nothing else is supported.
 */
export function preferredStrategy(
  supported: readonly Strategy[],
  options: { readonly launching: boolean }
): Strategy | undefined {
  return STRATEGY_PREFERENCE.find(
    (strategy) => supported.includes(strategy) && (strategy !== "launch-injection" || options.launching)
  );
}
