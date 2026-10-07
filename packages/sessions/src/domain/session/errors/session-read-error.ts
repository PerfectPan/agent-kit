import type { CodingAgentId } from "@rivus/agent-kit-catalog";

/** The session path does not exist, or a file of the session disappeared while it was read. */
export interface SessionNotFound {
  readonly _tag: "SessionNotFound";
  readonly path: string;
}

/** The ref named no adapter in the table, and no adapter's `detect` recognized the file. */
export interface NoAdapterAccepted {
  readonly _tag: "NoAdapterAccepted";
  readonly path: string;
}

/** The ref names an agent that has no session adapter in the table. */
export interface CapabilityUnsupported {
  readonly _tag: "CapabilityUnsupported";
  readonly agent: CodingAgentId;
}

/** A file or directory could not be read, for example for lack of permission. */
export interface ReadFailed {
  readonly _tag: "ReadFailed";
  readonly path: string;
  readonly message: string;
  readonly cause?: unknown;
}
