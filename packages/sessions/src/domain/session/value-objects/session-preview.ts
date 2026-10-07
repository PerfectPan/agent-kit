/** What an agent's preview rule finds in the records at both ends of a session file. */
export interface SessionPreview {
  /** The agent's own title for the session. */
  title?: string;
  cwd?: string;
  startedAt?: number;
  lastAt?: number;
  firstPrompt?: string;
  sessionId?: string;
}
