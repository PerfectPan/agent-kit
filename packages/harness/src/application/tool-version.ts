// Replaced with the published version when the shell package is built; sources run in tests see none.
declare const __AGENT_KIT_VERSION__: string | undefined;

/** The kit version the ledger records with each write. */
export const TOOL_VERSION: string = typeof __AGENT_KIT_VERSION__ === "string" ? __AGENT_KIT_VERSION__ : "0.0.0-dev";
