import * as Context from "effect/Context";

import type { Platform } from "./platform.js";

const KEY = "@rivus/agent-kit/platform/Platform/v1";

// isolatedDeclarations rejects a call expression in `extends`, so the generated base class gets an explicit type.
const PlatformServiceBase: Context.ServiceClass<PlatformService, typeof KEY, Platform> = Context.Service<
  PlatformService,
  Platform
>()(KEY);

/**
 * The plain `Platform` as an Effect service. Effect use cases and adapters read it with `yield* PlatformService`;
 * an application provides it with `NodePlatformLive` or `Layer.succeed(PlatformService, platform)`.
 */
export class PlatformService extends PlatformServiceBase {}
