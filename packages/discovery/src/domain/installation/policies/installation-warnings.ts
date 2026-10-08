import type { Installation } from "../value-objects/installation.js";
import type { ProbeProblem } from "../value-objects/probe-problem.js";
import type { ProbeRecipe } from "../value-objects/probe-recipe.js";

const SHELL_SHIM_WARNING =
  "The command is a Windows .cmd or .bat shim, which runs only through a shell; detection does not run it, so the agent is at most found.";

/**
 * The warnings of one detection: the recipe's caveats about its own facts, plus what this run adds — a Windows shim
 * detection found but did not run, so the agent is at most `found` no matter what else the run learned.
 */
export function installationWarnings(recipe: ProbeRecipe, problems: readonly ProbeProblem[]): Installation["warnings"] {
  return problems.some((problem) => problem._tag === "CommandFailed" && problem.reason === "shell-shim-not-run")
    ? [...recipe.warnings, SHELL_SHIM_WARNING]
    : recipe.warnings;
}
