import { expect, it } from "vite-plus/test";

import { DEFAULT_LAYER_PATH, resolveLayerPath } from "./layer-paths.ts";
import { layerReducer } from "./layer-reducer.ts";

it("resolves focused tools, functions and providers and restores the default on leave", () => {
  let focus = layerReducer(null, { type: "focus", id: "orchestrator" });
  expect(resolveLayerPath(focus).collab).toBe(true);
  focus = layerReducer(focus, { type: "focus", id: "listSessions" });
  expect(resolveLayerPath(focus).fn).toBe("listSessions");
  focus = layerReducer(focus, { type: "focus", id: "codex" });
  expect(resolveLayerPath(focus).providerId).toBe("codex");
  focus = layerReducer(focus, { type: "focus", id: null });
  expect(resolveLayerPath(focus)).toBe(DEFAULT_LAYER_PATH);
});
