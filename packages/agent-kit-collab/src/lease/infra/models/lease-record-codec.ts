import * as z from "zod/mini";

import type { HolderSnapshot } from "../../domain/lease/value-objects/holder.js";
import type { LeaseSnapshot } from "../../domain/lease/value-objects/lease-snapshot.js";

const holderSchema = z.object({ host: z.string(), bootId: z.string(), pid: z.number(), startTime: z.number() });

const snapshotSchema = z.object({
  key: z.string(),
  generation: z.number(),
  revision: z.number(),
  holder: z.nullable(holderSchema),
  holderId: z.nullable(z.string()),
  renewedAt: z.number()
});

/** Checks the shape of a stored record; the Lease aggregate checks its invariants when the manager restores it. */
export function decodeSnapshot(value: unknown): LeaseSnapshot | undefined {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** One stored row's columns, as the table holds them. */
interface LeaseRowColumns {
  readonly key: string;
  readonly generation: number;
  readonly revision: number;
  readonly holder: string | null;
  readonly holder_id: string | null;
  readonly renewed_at: number;
}

/** The columns of one stored row, in the database's snake_case: the repository reads the row at the boundary through this schema. */
const rowSchema = z.object({
  key: z.string(),
  generation: z.number(),
  revision: z.number(),
  holder: z.union([z.string(), z.null()]),
  holder_id: z.nullable(z.string()),
  renewed_at: z.number()
});

/** The columns of one stored row, or `undefined` when the row is not the shape the table holds. */
export function decodeLeaseRow(row: unknown): LeaseRowColumns | undefined {
  return rowSchema.safeParse(row).data;
}

export function decodeHolder(json: string | null): HolderSnapshot | null | undefined {
  if (json === null) {
    return null;
  }
  try {
    const parsed = holderSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Only the identity fields, whatever else the platform's `ProcessIdentity` carries. */
export function encodeHolder(holder: HolderSnapshot | null): string | null {
  if (holder === null) {
    return null;
  }
  const { host, bootId, pid, startTime } = holder;
  return JSON.stringify({ host, bootId, pid, startTime });
}
