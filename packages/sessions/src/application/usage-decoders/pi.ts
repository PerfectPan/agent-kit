import { PI_SESSION_FILES, piSessionStem, piUsageKey, piUsageLines, piUsageRoots } from "../../agents/pi/index.js";
import { basenamePath } from "../../domain/session/index.js";
import type { UsageDecoder } from "../usage-ports.js";
import { decodeJsonlUsage, fileSources, type JsonlUsageLayout, sameFile } from "./files.js";

const AGENT = "pi";

const layout: JsonlUsageLayout = {
  agent: AGENT,
  file: sameFile((path) => ({ sessionId: piSessionStem(path) })),
  decoder: piUsageLines
};

/** Every session file under `<home>/sessions`. */
export const piUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: piUsageKey,
  sources(platform, home, options = {}) {
    return fileSources(platform, AGENT, piUsageRoots(home), PI_SESSION_FILES, { ...options, identify: basenamePath });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, layout, options);
  }
};
