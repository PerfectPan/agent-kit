import type { Result } from "@rivus/agent-kit-catalog";
import * as Effect from "effect/Effect";

/** Moves a plain `Result` into the typed error channel, where `catchTag` sees its error. */
export const fromResult = <A, E>(result: Result<A, E>): Effect.Effect<A, E> =>
  result.ok ? Effect.succeed(result.value) : Effect.fail(result.error);
