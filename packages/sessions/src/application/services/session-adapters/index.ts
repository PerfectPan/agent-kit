import type { SessionAdapter } from "../../spi.js";

/** The built-in session adapters. The shell merges `providers` descriptors with a `sessions` service into these defaults. */
export const builtinSessionAdapters: {
  readonly [Id in never]: SessionAdapter;
} = {};
