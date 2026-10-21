import { scanUsage as contextScanUsage } from "@rivus/agent-kit-sessions/public";
import { usageTable } from "../providers/usage.js";
import { identityTable } from "../providers/identity.js";
import type { ProviderOptions } from "../providers/types.js";

export { isUsageRecord, noCacheInputTokens } from "@rivus/agent-kit-sessions/public";
export type { UsageDecoder, UsagePlatform, UsageRecord } from "@rivus/agent-kit-sessions/public";

type ScanUsageOptions = ProviderOptions<Parameters<typeof contextScanUsage>[1]>;

export function scanUsage(
  platform: Parameters<typeof contextScanUsage>[0],
  options: ScanUsageOptions = {}
): ReturnType<typeof contextScanUsage> {
  return contextScanUsage(platform, {
    ...options,
    providers: { usage: usageTable(options.providers), identity: identityTable(options.providers) }
  });
}
