import * as Effect from "effect/Effect";

import type { InstallScope } from "../domain/install-plan/index.js";
import { sha256Hex } from "./content-hash.js";
import type { LedgerScope } from "./ports.js";

/** Where to install: the user's agent homes, or one project. */
export interface ScopeOptions {
  /** `user` by default. */
  readonly scope?: InstallScope;
  /** The project root, required for `project`: absolute, as the caller resolved it. */
  readonly projectRoot?: string;
}

/** The ledger of a scope; a project's ledger is named after a hash of its root, so any path makes a safe file name. */
export function ledgerScope(options: ScopeOptions): Effect.Effect<LedgerScope> {
  if ((options.scope ?? "user") === "user") {
    return Effect.succeed({ key: "user", scope: "user" });
  }
  const root = options.projectRoot ?? "";
  return Effect.map(sha256Hex(root), (hex) => ({
    key: `project-${hex.slice(0, 16)}`,
    scope: "project",
    projectRoot: root
  }));
}
