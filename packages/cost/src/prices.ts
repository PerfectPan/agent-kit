// The price-table entry, `@rivus/agent-kit/cost/prices`: a snapshot of LiteLLM's price list for the models the
// supported agents record. It is apart from public.ts so a host that brings its own table does not load this one.
export { litellmPrices, litellmPricesVersion } from "./domain/pricing/adapters/litellm-prices.js";
