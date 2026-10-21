/**
 * How an Artifact reaches an agent. `launch-injection`: launch arguments or ACP session parameters when the caller
 * starts the agent, leaving nothing behind. `native-plugin`: the agent's plugin or extension mechanism.
 * `scan-directory`: a directory the agent scans, such as a skills directory. `shared-config`: an append-only edit of a
 * configuration file other tools also write.
 */
export type Strategy = "launch-injection" | "native-plugin" | "scan-directory" | "shared-config";
