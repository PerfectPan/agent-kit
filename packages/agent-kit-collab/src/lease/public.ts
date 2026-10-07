export { fileLeaseStore } from "./adapters/file-lease-store.js";
export type { FileLeaseStoreOptions } from "./adapters/file-lease-store.js";
export { memoryLeaseStore } from "./adapters/memory-lease-store.js";
export { sqliteLeaseStore } from "./adapters/sqlite-lease-store.js";
export type { SqliteLeaseStoreOptions } from "./adapters/sqlite-lease-store.js";
export { createLeaseManager } from "./application/lease-manager.js";
export type {
  AcquireOptions,
  LeaseConfig,
  LeaseConfigInvalid,
  LeaseHandle,
  LeaseManager
} from "./application/lease-manager.js";
export { LeaseStore } from "./application/ports.js";
export type { LeaseStoreFailure, LeaseStoreShape } from "./application/ports.js";
export { canAcquire, checkFence, holderLiveness, isFresh, nextFencingToken } from "./domain/lease/index.js";
export type {
  AcquisitionView,
  FenceRejected,
  FencingToken,
  Holder,
  HolderLiveness,
  LeaseHeld,
  LeaseLost,
  LeaseObservation,
  LeaseSnapshot
} from "./domain/lease/index.js";
