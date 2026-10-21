import type { UsageDecoder } from "../../spi.js";

/** The built-in usage decoders. The shell merges `providers` descriptors with a `usage` service into these defaults. */
export const builtinUsageDecoders: {
  readonly [Id in never]: UsageDecoder;
} = {};
