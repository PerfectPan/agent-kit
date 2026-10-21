import type { Platform } from "@rivus/agent-kit-platform/public";

/** The parts of the platform acp uses: `process.spawn` for the agent, `fs` for client file calls, `clock` for events. */
export type AcpPlatform = Pick<Platform, "fs" | "process" | "clock">;
