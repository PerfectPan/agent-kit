import type { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Layer from "effect/Layer";

import type { AgentCli, ArtifactFiles, ExternalOwner, LedgerLock, LedgerStore } from "../../application/ports.js";
import { ChezmoiExternalOwnerLive } from "../adapters/chezmoi-external-owner.js";
import { FileLedgerStoreLive } from "../repository/file-ledger-store.js";
import { PlatformArtifactFilesLive } from "../adapters/platform-artifact-files.js";
import { ProcessAgentCliLive } from "../adapters/process-agent-cli.js";
import { SqliteLedgerLockLive } from "../adapters/sqlite-ledger-lock.js";

/**
 * The default ports of the harness use cases: the agents' files through the platform, the file ledger store, the
 * SQLite LedgerLock, agent command lines through `Platform.process.run`, and chezmoi as the ExternalOwner. The use
 * cases read `PlatformService` as well, so provide the platform with `Layer.provideMerge`, for example
 * `HarnessLive.pipe(Layer.provideMerge(NodePlatformLive))`. Replace one port by merging another Layer over it.
 */
export const HarnessLive: Layer.Layer<
  ArtifactFiles | LedgerStore | LedgerLock | AgentCli | ExternalOwner,
  never,
  PlatformService
> = Layer.mergeAll(
  PlatformArtifactFilesLive,
  FileLedgerStoreLive,
  SqliteLedgerLockLive,
  ProcessAgentCliLive,
  ChezmoiExternalOwnerLive
);
