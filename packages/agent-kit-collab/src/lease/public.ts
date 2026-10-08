export { fileLeaseRepository } from "./infra/repository/file-lease-repository.js";
export type { FileLeaseRepositoryOptions } from "./infra/repository/file-lease-repository.js";
export { memoryLeaseRepository } from "./infra/repository/memory-lease-repository.js";
export { sqliteLeaseRepository } from "./infra/repository/sqlite-lease-repository.js";
export type { SqliteLeaseRepositoryOptions } from "./infra/repository/sqlite-lease-repository.js";
export { createLeaseManager } from "./application/use-cases/lease-manager.js";
export type { AcquireOptions, LeaseConfig, LeaseHandle, LeaseManager } from "./application/use-cases/lease-manager.js";
export { LeaseRepository } from "./application/ports.js";
export type { LeaseRepositoryFailure, LeaseRepositoryShape, RevisionConflict } from "./application/ports.js";
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
