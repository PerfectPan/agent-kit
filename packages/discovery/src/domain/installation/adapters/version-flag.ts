import { versionFromOutput } from "../value-objects/version.js";
import { type VersionProbe } from "../spi/probe-recipe.js";

/** `<command> --version`, read with the default version parser, with no known side effects. */
export const VERSION_FLAG: VersionProbe = { args: ["--version"], parse: versionFromOutput, sideEffects: [] };
