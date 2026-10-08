export { fileLeaseStore } from "./infra/repository/file-lease-store.js";
export type { FileLeaseStoreOptions } from "./infra/repository/file-lease-store.js";
export { memoryLeaseStore } from "./infra/repository/memory-lease-store.js";
export { sqliteLeaseStore } from "./infra/repository/sqlite-lease-store.js";
export type { SqliteLeaseStoreOptions } from "./infra/repository/sqlite-lease-store.js";
export { createLeaseManager } from "./application/use-cases/lease-manager.js";
export type { AcquireOptions, LeaseConfig, LeaseHandle, LeaseManager } from "./application/use-cases/lease-manager.js";
export { LeaseStore } from "./application/ports.js";
export type { LeaseStoreFailure, LeaseStoreShape } from "./application/ports.js";
export { canAcquire, checkFence, holderLiveness, isFresh, nextFencingToken } from "./domain/lease/index.js";
export type {
  AcquisitionView,
  FenceRejected,
  FencingToken,
  Holder,
  HolderLiveness,
  LeaseConfigInvalid,
  LeaseHeld,
  LeaseLost,
  LeaseObservation,
  LeaseSnapshot
} from "./domain/lease/index.js";
