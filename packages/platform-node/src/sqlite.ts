import type { PlatformSqlite } from "@rivus/agent-kit-platform/public";

type SqliteModule = typeof import("node:sqlite");

type WarningArgs = [
  warning: string | Error,
  typeOrOptions?: string | NodeJS.EmitWarningOptions | NodeJS.EmitWarningOptions["ctor"],
  ...rest: unknown[]
];

let sqliteModule: SqliteModule | undefined;

function isSqliteExperimentalWarning(warning: WarningArgs[0], typeOrOptions: WarningArgs[1]): boolean {
  // Known-union narrowing for Node's warning options overload.
  const type =
    typeOrOptions && typeof typeOrOptions === "object" && "type" in typeOrOptions ? typeOrOptions.type : typeOrOptions;
  const message = warning instanceof Error ? warning.message : warning;
  return type === "ExperimentalWarning" && typeof message === "string" && message.startsWith("SQLite ");
}

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
  process.emitWarning = function filteredEmitWarning(this: NodeJS.Process, ...args: WarningArgs) {
    if (!isSqliteExperimentalWarning(args[0], args[1])) {
      Reflect.apply(emitWarning, this, args);
    }
  };
  try {
    // @types/node types the known-id overload as always present, but Node without node:sqlite returns undefined.
    sqliteModule = process.getBuiltinModule("node:sqlite") as SqliteModule | undefined;
  } finally {
    process.emitWarning = emitWarning;
  }
  if (sqliteModule === undefined) {
    throw new Error("node:sqlite is not available in this Node.js runtime");
  }
  return sqliteModule;
}

export const nodeSqlite: PlatformSqlite = {
  open(path, options) {
    const { DatabaseSync } = loadSqlite();
    return new DatabaseSync(path, { readOnly: options?.readonly ?? false });
  }
};
