/** A path could not be checked, for example for lack of permission; `code` is the errno code. */
export interface StatFailed {
  readonly _tag: "StatFailed";
  readonly path: string;
  readonly code: string;
}

/**
 * A probe command gave no answer: it could not start (`start-failed`, with the error message), ran out of time
 * (`timed-out`), printed more than the platform collects (`output-too-large`), finished with output its parser does
 * not recognize (`unrecognized`, with the exit code), or is a Windows `.cmd` or `.bat` file, which only a shell runs
 * (`shell-shim-not-run`). The command's output is not kept, because a status command can print account details.
 */
export interface CommandFailed {
  readonly _tag: "CommandFailed";
  readonly purpose: "version" | "auth";
  readonly path: string;
  readonly args: readonly string[];
  readonly reason: "start-failed" | "timed-out" | "output-too-large" | "unrecognized" | "shell-shim-not-run";
  readonly exitCode?: number | null;
  readonly message?: string;
}

/**
 * A credential file exists but gave no answer: it could not be read (`read-failed`, with the errno code), is larger
 * than 8 MiB (`too-large`), or holds content its parser does not recognize (`unrecognized`). Its content is never
 * reported.
 */
export interface CredentialFileFailed {
  readonly _tag: "CredentialFileFailed";
  readonly path: string;
  readonly reason: "read-failed" | "too-large" | "unrecognized";
  readonly code?: string;
}

/** A check that could not complete. Detection goes on; the problem is reported with the installation. */
export type ProbeProblem = StatFailed | CommandFailed | CredentialFileFailed;
