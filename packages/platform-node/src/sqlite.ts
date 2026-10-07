import type { PlatformSqlite } from "@rivus/agent-kit-platform";

type SqliteModule = typeof import("node:sqlite");

let sqliteModule: SqliteModule | undefined;

export const nodeSqlite: PlatformSqlite = {
  open(path, options) {
    const { DatabaseSync } = loadSqlite();
    return new DatabaseSync(path, { readOnly: options?.readonly ?? false });
  }
};

/**
 * Loads node:sqlite on first use, so importing this package never pulls it in. Node versions that still mark it
 * experimental print an ExperimentalWarning when it loads; only that warning is dropped.
 */
function loadSqlite(): SqliteModule {
  if (sqliteModule !== undefined) {
    return sqliteModule;
  }
  // Kept to be restored unchanged; it is only called through Reflect.apply with the original `this`.
  // oxlint-disable-next-line typescript/unbound-method
  const emitWarning = process.emitWarning;
  process.emitWarning = function filteredEmitWarning(this: NodeJS.Process, ...args: unknown[]) {
    if (!isSqliteExperimentalWarning(args[0], args[1])) {
      Reflect.apply(emitWarning, this, args);
    }
  } as typeof emitWarning;
  try {
    sqliteModule = process.getBuiltinModule("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
  if (sqliteModule === undefined) {
    throw new Error("node:sqlite is not available in this Node.js runtime");
  }
  return sqliteModule;
}

function isSqliteExperimentalWarning(warning: unknown, typeOrOptions: unknown): boolean {
  const type =
    typeof typeOrOptions === "object" && typeOrOptions !== null && "type" in typeOrOptions
      ? typeOrOptions.type
      : typeOrOptions;
  const message = warning instanceof Error ? warning.message : warning;
  return type === "ExperimentalWarning" && typeof message === "string" && message.startsWith("SQLite ");
}
