import { decodeUsage as contextDecodeUsage } from "@rivus/agent-kit-sessions/public";
import { listUsageSources as contextListUsageSources } from "@rivus/agent-kit-sessions/public";
import { scanUsage as contextScanUsage } from "@rivus/agent-kit-sessions/public";
import { usageTable } from "../providers/usage.js";
import { identityTable } from "../providers/identity.js";
import type { ProviderOptions } from "../providers/types.js";

export {
  addUsage,
  isUsageRecord,
  isUsageSource,
  noCacheInputTokens,
  toAiSdkUsage,
  toOtelAttributes
} from "@rivus/agent-kit-sessions/public";
export type {
  AiSdkUsage,
  CapabilityUnsupported,
  CostSource,
  DecodeUsageOptions,
  ModelUsage,
  OtelAttributeOptions,
  ReadFailed,
  SessionErrorCode,
  SessionListError,
  SessionNotFound,
  SourceChanged,
  SourcePointer,
  SqliteUnavailable,
  UnknownFormatGeneration,
  Usage,
  UsageCursor,
  UsageDecodeError,
  UsageDecodeFailure,
  UsageDecoder,
  UsageGranularity,
  UsagePlatform,
  UsageRecord,
  UsageScan,
  UsageScanSource,
  UsageScanState,
  UsageSource,
  UsageSourceFailure,
  UsageSourceOptions,
  UsageStream,
  UsageTarget
} from "@rivus/agent-kit-sessions/public";

export function decodeUsage(
  platform: Parameters<typeof contextDecodeUsage>[0],
  agent: Parameters<typeof contextDecodeUsage>[1],
  target: Parameters<typeof contextDecodeUsage>[2],
  options: ProviderOptions<Parameters<typeof contextDecodeUsage>[3]> = {}
): ReturnType<typeof contextDecodeUsage> {
  return contextDecodeUsage(platform, agent, target, {
    ...options,
    providers: { usage: usageTable(options.providers), identity: identityTable(options.providers) }
  });
}

export type ListUsageSourcesOptions = ProviderOptions<Parameters<typeof contextListUsageSources>[1]>;

export function listUsageSources(
  platform: Parameters<typeof contextListUsageSources>[0],
  options: ListUsageSourcesOptions = {}
): ReturnType<typeof contextListUsageSources> {
  return contextListUsageSources(platform, {
    ...options,
    providers: { usage: usageTable(options.providers), identity: identityTable(options.providers) }
  });
}

export type ScanUsageOptions = ProviderOptions<Parameters<typeof contextScanUsage>[1]>;

export function scanUsage(
  platform: Parameters<typeof contextScanUsage>[0],
  options: ScanUsageOptions = {}
): ReturnType<typeof contextScanUsage> {
  return contextScanUsage(platform, {
    ...options,
    providers: { usage: usageTable(options.providers), identity: identityTable(options.providers) }
  });
}
