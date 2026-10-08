import * as z from "zod/mini";

import type { Holder, LeaseSnapshot } from "../../domain/lease/index.js";

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

export function decodeHolder(json: string | null): Holder | null | undefined {
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
export function encodeHolder(holder: Holder | null): string | null {
  if (holder === null) {
    return null;
  }
  const { host, bootId, pid, startTime } = holder;
  return JSON.stringify({ host, bootId, pid, startTime });
}
