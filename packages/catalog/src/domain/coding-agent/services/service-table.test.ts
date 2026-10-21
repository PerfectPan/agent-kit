import { describe, expect, it } from "vite-plus/test";

import { AgentKitError } from "../../result/errors/agent-kit-error.js";
import type { ServiceTable } from "../value-objects/service-table.js";
import { lookupService, requireService } from "./service-table.js";

describe("service lookups", () => {
  it.each([false, 0, "", { name: "provider" }])("returns the defined provider %j unchanged", (provider) => {
    const table = { custom: provider };
    expect(lookupService("custom", table)).toEqual({ ok: true, value: provider });
    expect(requireService("custom", table)).toBe(provider);
  });

  it.each(["missing", "undefined", "null", "toString", "constructor"])("returns unsupported data for %s", (agent) => {
    const table: ServiceTable<string | null> = { undefined: undefined, null: null };
    expect(lookupService(agent, table)).toEqual({ ok: false, error: { _tag: "CapabilityUnsupported", agent } });
    expect(() => requireService(agent, table)).toThrow(AgentKitError);
  });

  it("throws the kit error for an unsupported agent named in options", () => {
    expect(() => requireService("custom", {})).toThrow(AgentKitError);
    expect(() => requireService("custom", {})).toThrow(
      expect.objectContaining({
        code: "capability-unsupported",
        message: 'Agent "custom" has no provider for this capability'
      })
    );
    expect(() => requireService("custom", {}, "has no usage decoder")).toThrow('Agent "custom" has no usage decoder');
  });
});
