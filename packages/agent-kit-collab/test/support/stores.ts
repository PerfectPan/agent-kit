import { join } from "node:path";

import type { Platform } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Layer from "effect/Layer";

import {
  fileLeaseRepository,
  LeaseRepository,
  type LeaseRepositoryFailure,
  memoryLeaseRepository,
  sqliteLeaseRepository
} from "../../src/lease/public.js";
import { tempDir, testPlatform } from "./platform.js";

export interface StoreCase {
  readonly name: string;
  readonly persistent: boolean;
  readonly platform: Platform;
  /** A new store over a new location, and a way to build another store over the same location. */
  readonly make: () => {
    readonly layer: Layer.Layer<LeaseRepository | PlatformService, LeaseRepositoryFailure>;
    readonly reopen: () => Layer.Layer<LeaseRepository | PlatformService, LeaseRepositoryFailure>;
    /** The directory or database file the two layers read and write, for tests that reach into the storage. */
    readonly location: string;
  };
}

function withPlatform(
  platform: Platform,
  repository: Layer.Layer<LeaseRepository, LeaseRepositoryFailure, PlatformService>
): Layer.Layer<LeaseRepository | PlatformService, LeaseRepositoryFailure> {
  return Layer.provideMerge(repository, Layer.succeed(PlatformService, platform));
}

const nodePlatform = testPlatform();
const noSqlite = testPlatform({ sqlite: false });

export const storeCases: readonly StoreCase[] = [
  {
    name: "memory",
    persistent: false,
    platform: nodePlatform,
    make: () => {
      const layer = withPlatform(nodePlatform, memoryLeaseRepository());
      return { layer, reopen: () => layer, location: "" };
    }
  },
  {
    name: "sqlite",
    persistent: true,
    platform: nodePlatform,
    make: () => {
      const path = join(tempDir(), "leases.db");
      const open = () => withPlatform(nodePlatform, sqliteLeaseRepository({ path }));
      return { layer: open(), reopen: open, location: path };
    }
  },
  {
    name: "file without SQLite",
    persistent: true,
    platform: noSqlite,
    make: () => {
      const dir = tempDir();
      const open = () => withPlatform(noSqlite, fileLeaseRepository({ dir }));
      return { layer: open(), reopen: open, location: dir };
    }
  }
];
