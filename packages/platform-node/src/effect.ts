import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Layer from "effect/Layer";

import { createNodePlatform } from "./create-node-platform.js";

/** Provides `PlatformService` with `createNodePlatform()`, called each time the Layer is built. */
export const NodePlatformLive: Layer.Layer<PlatformService> = Layer.sync(PlatformService, () => createNodePlatform());
