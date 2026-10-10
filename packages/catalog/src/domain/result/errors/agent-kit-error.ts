// A process can load two copies of the kit (two versions, or the bundled and the unbundled build). The brand is a
// registered symbol, so both copies recognize each other's errors where `instanceof` against one class would not.
const BRAND = Symbol.for("@rivus/agent-kit/AgentKitError");

export interface AgentKitErrorOptions {
  readonly cause?: unknown;
}

export function isAgentKitError(value: unknown): value is AgentKitError {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
}

/**
 * The only public class of the kit. Expected failures are returned as tagged `Result` values; this error is thrown
 * for caller mistakes such as naming an agent that has no adapter, and `code` names which one.
 */
export class AgentKitError<Code extends string = string> extends Error {
  readonly code: Code;

  constructor(code: Code, message: string, options: AgentKitErrorOptions = {}) {
    super(message, "cause" in options ? { cause: options.cause } : undefined);
    this.name = "AgentKitError";
    this.code = code;
    Object.defineProperty(this, BRAND, { value: true });
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return isAgentKitError(value);
  }
}
