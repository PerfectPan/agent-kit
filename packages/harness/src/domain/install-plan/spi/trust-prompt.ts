/**
 * `hook-review`: the agent asks the user to review a new or changed hook (agents that record trust by content hash).
 * `plugin-consent`: the agent asks before it enables an installed plugin or extension. `folder-trust`: hooks wait
 * until the user trusts the folder.
 */
export type TrustPromptKind = "hook-review" | "plugin-consent" | "folder-trust";
