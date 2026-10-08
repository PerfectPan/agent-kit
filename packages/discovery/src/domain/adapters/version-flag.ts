import { versionFromOutput, type VersionProbe } from "../installation/index.js";

/** `<command> --version`, read with the default version parser, with no known side effects. */
export const VERSION_FLAG: VersionProbe = { args: ["--version"], parse: versionFromOutput, sideEffects: [] };
