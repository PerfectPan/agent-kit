import type { ServiceTable } from "@rivus/agent-kit-catalog";

import type { AcpProfile } from "../index.js";
import { codexAcpProfile } from "./codex.js";

export type AcpProfiles = ServiceTable<AcpProfile>;

/** The agents `connectAgent` can launch by id. A shell caller adds or overrides one through `providers` descriptors with an `acp` service. */
export const builtinAcpProfiles: AcpProfiles = {
  codex: codexAcpProfile
};
