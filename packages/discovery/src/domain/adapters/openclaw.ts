import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const openclawProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "openclaw",
  displayName: "OpenClaw",
  kind: "cli",
  commands: ["openclaw"],
  appPaths: [],
  configPaths: ["~/.openclaw"],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: ["OPENCLAW_STATE_DIR and OPENCLAW_HOME overrides of the OpenClaw directory are not followed."]
};
