import type { SessionAdapter } from "../../spi.js";
import { codexSessionAdapter } from "./codex.js";

/** The built-in session adapters. The shell merges `providers` descriptors with a `sessions` service into these defaults. */
export const builtinSessionAdapters: {
  readonly codex: SessionAdapter;
} = {
  codex: codexSessionAdapter
};
