import { describe, expect, it } from "vite-plus/test";

import type { HookDialect } from "../spi/hook-dialect.js";
import { readHookEvent } from "./read-hook-event.js";

const dialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "declared",
  delivery: "plugin",
  fields: { event: { paths: [["event"]] } },
  events: { start: { lifecycle: { phase: "start" } } }
};
const first: HookDialect = {
  ...dialect,
  agent: "first",
  hostMarkers: { payloadFields: ["firstMarker"], env: ["FIRST_HOST"] },
  runsHooksOf: [{ agent: "declared", files: ["~/settings"], byDefault: true, events: { start: "start" } }]
};
const second: HookDialect = { ...first, agent: "second", hostMarkers: { payloadFields: ["secondMarker"] } };
const hooks = { declared: dialect, first, second };

describe("declared host markers", () => {
  it("prioritizes all payload markers over env markers, then hooks table order", () => {
    expect(
      readHookEvent(
        "declared",
        { event: "start", secondMarker: "yes" },
        { FIRST_HOST: "yes" },
        { providers: { hooks } }
      ).agent
    ).toBe("second");
    expect(
      readHookEvent("declared", { firstMarker: "yes", secondMarker: "yes" }, {}, { providers: { hooks } }).agent
    ).toBe("first");
    expect(
      readHookEvent(
        "declared",
        { firstMarker: "yes", secondMarker: "yes" },
        {},
        { providers: { hooks: { second, first, declared: dialect } } }
      ).agent
    ).toBe("second");
  });
  it("uses env markers only for declared foreign hook relationships and ignores empty markers", () => {
    expect(readHookEvent("declared", {}, { FIRST_HOST: "yes" }, { providers: { hooks } }).agent).toBe("first");
    expect(readHookEvent("second", {}, { FIRST_HOST: "yes" }, { providers: { hooks } }).agent).toBe("second");
    expect(readHookEvent("declared", { firstMarker: "" }, { FIRST_HOST: "" }, { providers: { hooks } }).agent).toBe(
      "declared"
    );
  });
});
