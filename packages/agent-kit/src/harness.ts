import { planInstall as contextPlanInstall } from "@rivus/agent-kit-harness/public";
import { verify as contextVerify } from "@rivus/agent-kit-harness/public";
import { uninstall as contextUninstall } from "@rivus/agent-kit-harness/public";
import { doctor as contextDoctor } from "@rivus/agent-kit-harness/public";
import { installTable } from "./providers/install.js";
import { hooksTable } from "./providers/hooks.js";
import { identityTable } from "./providers/identity.js";
import type { ProviderOptions } from "./providers/types.js";

export {
  AgentCli,
  applyInstall,
  ArtifactFiles,
  CONFLICT_CHOICES,
  discardPlan,
  ExternalOwner,
  FileLedgerRepositoryLive,
  HarnessLive,
  inventory,
  LedgerRepository,
  locatorKey,
  PlatformArtifactFilesLive,
  SqliteLedgerLockLive
} from "@rivus/agent-kit-harness/public";
export type {
  AgentCommand,
  ArtifactContent,
  ArtifactLocator,
  Bundle,
  BundleRef,
  CliRegistration,
  ConflictChoice,
  HarnessServices,
  HookRegistration,
  HookSpec,
  InstallAdapter,
  InstallContext,
  InstallPlan,
  JsonValue,
  LedgerScope,
  PlanConflict,
  TrustPrompt
} from "@rivus/agent-kit-harness/public";

type PlanInstallOptions = ProviderOptions<Parameters<typeof contextPlanInstall>[1]>;

export function planInstall(
  bundle: Parameters<typeof contextPlanInstall>[0],
  options: PlanInstallOptions
): ReturnType<typeof contextPlanInstall> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextPlanInstall(bundle, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

type VerifyOptions = ProviderOptions<Parameters<typeof contextVerify>[1]>;

export function verify(
  owner: Parameters<typeof contextVerify>[0],
  options: VerifyOptions = {}
): ReturnType<typeof contextVerify> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextVerify(owner, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

type UninstallOptions = ProviderOptions<Parameters<typeof contextUninstall>[1]>;

export function uninstall(
  owner: Parameters<typeof contextUninstall>[0],
  options: UninstallOptions = {}
): ReturnType<typeof contextUninstall> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextUninstall(owner, {
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}

type DoctorOptions = ProviderOptions<Parameters<typeof contextDoctor>[0]>;

export function doctor(options: DoctorOptions = {}): ReturnType<typeof contextDoctor> {
  if (options.providers !== undefined) {
    identityTable(options.providers);
  }
  return contextDoctor({
    ...options,
    providers: {
      install: installTable(options.providers),
      hooks: hooksTable(options.providers)
    }
  });
}
