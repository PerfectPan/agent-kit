/** Where a login observation came from. */
export type AuthSource =
  /** The agent's own read-only status command. */
  | { readonly kind: "command"; readonly command: string; readonly args: readonly string[] }
  /** A stored credential file exists; a file the recipe parses is read for non-secret facts only. */
  | { readonly kind: "credential-file"; readonly path: string }
  /** An environment variable that authenticates the agent is set. */
  | { readonly kind: "env"; readonly variable: string };

/** What one login check says. `method` names how the agent is logged in, such as `api-key`. */
export interface AuthReading {
  readonly loggedIn: boolean;
  readonly method?: string;
}

/**
 * One login check and its answer. A credential file the recipe does not parse has no reading — its existence was the
 * check, which `resolveAuthState` reads as logged in; a command or an authenticating variable always carries its
 * reading.
 */
export type AuthObservation =
  | { readonly source: Exclude<AuthSource, { kind: "credential-file" }>; readonly reading: AuthReading }
  | { readonly source: Extract<AuthSource, { kind: "credential-file" }>; readonly reading?: AuthReading };

/**
 * Whether the agent is logged in, as far as detection can tell. Only the agent's own status command can report
 * `logged-out`: missing credential files or variables say nothing, because agents also keep credentials in places
 * detection does not look at, such as the system keychain.
 */
export type AuthState =
  | { readonly status: "logged-in"; readonly method?: string; readonly source: AuthSource }
  | { readonly status: "logged-out"; readonly source: AuthSource }
  | { readonly status: "unknown" };
