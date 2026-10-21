export * from "./public.js";

// Shared with sibling contexts; these helpers do not add shell exports.
export { homeRuleOf } from "./domain/coding-agent/services/identity.js";
export { lookupService, requireService } from "./domain/coding-agent/services/service-table.js";
export type { ServiceTable } from "./domain/coding-agent/value-objects/service-table.js";
export type { CapabilityUnsupported } from "./domain/coding-agent/errors/capability-unsupported.js";
