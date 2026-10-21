import type { Provider } from "./types.js";
import { identityTable } from "./identity.js";
import { discoveryTable } from "./discovery.js";
import { hooksTable } from "./hooks.js";
import { installTable } from "./install.js";
import { sessionsTable } from "./sessions.js";
import { usageTable } from "./usage.js";
import { acpTable } from "./acp.js";

const identity = identityTable();
const discovery = discoveryTable();
const hooks = hooksTable();
const install = installTable();
const sessions = sessionsTable();
const usage = usageTable();
const acp = acpTable();

export const builtinProviders: readonly Provider[] = Object.keys(identity).map((id): Provider => ({
  id,
  identity: identity[id],
  discovery: discovery[id],
  hooks: hooks[id],
  install: install[id],
  sessions: sessions[id],
  usage: usage[id],
  acp: acp[id]
}));
