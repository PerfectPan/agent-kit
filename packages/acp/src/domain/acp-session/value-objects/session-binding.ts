import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";

/**
 * The caller's `sessionKey` bound to the ACP session that carries it, so a later connection can load that session.
 * A binding is removed when a cancel does not settle, because the agent may still be running the cancelled turn.
 */
export interface SessionBindingSnapshot {
  readonly sessionKey: string;
  readonly agent: CodingAgentId;
  readonly sessionId: string;
  readonly cwd: string;
}

export class SessionBinding {
  static restore(snapshot: SessionBindingSnapshot): SessionBinding {
    return new SessionBinding(snapshot);
  }

  readonly sessionKey: string;
  readonly agent: CodingAgentId;
  readonly sessionId: string;
  readonly cwd: string;

  private constructor(snapshot: SessionBindingSnapshot) {
    this.sessionKey = snapshot.sessionKey;
    this.agent = snapshot.agent;
    this.sessionId = snapshot.sessionId;
    this.cwd = snapshot.cwd;
    Object.freeze(this);
  }

  /**
   * The binding when the named agent made it. A store is shared by every agent, so a key may be bound to another
   * agent's session; to this connection that is no binding at all.
   */
  forAgent(agent: CodingAgentId): SessionBinding | undefined {
    return this.agent === agent ? this : undefined;
  }

  toSnapshot(): SessionBindingSnapshot {
    const { sessionKey, agent, sessionId, cwd } = this;
    return { sessionKey, agent, sessionId, cwd };
  }
}
