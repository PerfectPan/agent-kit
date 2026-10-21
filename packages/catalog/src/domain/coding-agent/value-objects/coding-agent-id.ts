/** A canonical agent id; `parseCodingAgentId` checks it with `CODING_AGENT_ID_PATTERN`. */
export type CodingAgentId = string;

/** The canonical id of a known CodingAgent, or a third-party id: lowercase letters and digits in `-`-joined words. */
export const CODING_AGENT_ID_PATTERN: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface InvalidCodingAgentId {
  readonly _tag: "InvalidCodingAgentId";
  readonly input: string;
}
