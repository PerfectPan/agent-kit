import { lookupService, type CodingAgentId, type ServiceTable } from "@rivus/agent-kit-catalog/public";
import { foreignHooksOf, type HookDialect } from "../spi/hook-dialect.js";
import type { PayloadView } from "../value-objects/payload-view.js";
import type { Env } from "../policies/payload-fields.js";

const present = (value: string | undefined): boolean => value !== undefined && value !== "";

/** Payload evidence wins over inherited environment; table order decides within each kind. */
export function sniffSource(
  declared: CodingAgentId,
  payload: PayloadView,
  env: Env,
  hooks: ServiceTable<HookDialect>
): CodingAgentId {
  for (const agent of Object.keys(hooks)) {
    const found = lookupService(agent, hooks);
    if (found.ok && found.value.hostMarkers?.payloadFields?.some((field) => present(payload.get([field])))) {
      return agent;
    }
  }
  for (const agent of Object.keys(hooks)) {
    const found = lookupService(agent, hooks);
    if (
      found.ok &&
      found.value.hostMarkers?.env?.some((name) => present(Object.hasOwn(env, name) ? env[name] : undefined)) &&
      foreignHooksOf(found.value).some((foreign) => foreign.agent === declared)
    ) {
      return agent;
    }
  }
  return declared;
}
