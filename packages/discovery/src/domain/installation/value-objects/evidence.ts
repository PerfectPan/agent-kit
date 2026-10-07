import type { Version } from "./version.js";

/** One observation that an agent is present on this machine. */
export type Evidence =
  /** `command` resolved on `PATH` to the file at `path`. */
  | { readonly kind: "command"; readonly command: string; readonly path: string }
  /** Running `path` with `args` exited successfully and printed `version`. */
  | { readonly kind: "version"; readonly path: string; readonly args: readonly string[]; readonly version: Version }
  /** An application bundle or directory exists. */
  | { readonly kind: "app"; readonly path: string }
  /** A configuration file or directory exists. */
  | { readonly kind: "config"; readonly path: string }
  /** An MCP configuration file exists. */
  | { readonly kind: "mcp-config"; readonly path: string };

export type EvidenceKind = Evidence["kind"];
