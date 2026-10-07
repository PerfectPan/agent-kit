/** What a probe command left behind: its exit code and output. Probes that timed out or did not start have none. */
export interface CommandOutput {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The version an agent reported for itself. */
export interface Version {
  /** The trimmed standard output of the version command, as the agent printed it. */
  readonly output: string;
  /** The first dotted version number in `output`, such as `0.154.0`. */
  readonly number?: string;
}

const VERSION_NUMBER = /\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?/;

/**
 * Reads a version from a command that exited with 0 and printed something to standard output. Standard error is
 * ignored, because agents print warnings there.
 */
export function versionFromOutput(output: CommandOutput): Version | undefined {
  const text = output.stdout.trim();
  if (output.code !== 0 || text === "") {
    return undefined;
  }
  const number = VERSION_NUMBER.exec(text)?.[0];
  return number === undefined ? { output: text } : { output: text, number };
}
