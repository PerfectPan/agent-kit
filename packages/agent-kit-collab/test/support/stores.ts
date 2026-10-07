import { join } from "node:path";

import type { Platform } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Layer from "effect/Layer";

import {
  fileLeaseStore,
  LeaseStore,
  type LeaseStoreFailure,
  memoryLeaseStore,
  sqliteLeaseStore
} from "../../src/lease/public.js";
import { tempDir, testPlatform } from "./platform.js";

export interface StoreCase {
  readonly name: string;
  readonly persistent: boolean;
  readonly platform: Platform;
  /** A new store over a new location, and a way to build another store over the same location. */
  readonly make: () => {
    readonly layer: Layer.Layer<LeaseStore | PlatformService, LeaseStoreFailure>;
    readonly reopen: () => Layer.Layer<LeaseStore | PlatformService, LeaseStoreFailure>;
  };
}

function withPlatform(
  platform: Platform,
  store: Layer.Layer<LeaseStore, LeaseStoreFailure, PlatformService>
): Layer.Layer<LeaseStore | PlatformService, LeaseStoreFailure> {
  return Layer.provideMerge(store, Layer.succeed(PlatformService, platform));
}

const nodePlatform = testPlatform();
const noSqlite = testPlatform({ sqlite: false });

export const storeCases: readonly StoreCase[] = [
  {
    name: "memory",
    persistent: false,
    platform: nodePlatform,
    make: () => {
      const layer = withPlatform(nodePlatform, memoryLeaseStore());
      return { layer, reopen: () => layer };
    }
  },
  {
    name: "sqlite",
    persistent: true,
    platform: nodePlatform,
    make: () => {
      const path = join(tempDir(), "leases.db");
      const open = () => withPlatform(nodePlatform, sqliteLeaseStore({ path }));
      return { layer: open(), reopen: open };
    }
  },
  {
    name: "file without SQLite",
    persistent: true,
    platform: noSqlite,
    make: () => {
      const dir = tempDir();
      const open = () => withPlatform(noSqlite, fileLeaseStore({ dir }));
      return { layer: open(), reopen: open };
    }
  }
];
