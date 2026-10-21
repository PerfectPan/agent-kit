import { describe, expect, it } from "vite-plus/test";

import type { CodingAgent } from "../value-objects/coding-agent.js";
import type { ServiceTable } from "../value-objects/service-table.js";
import { homeRuleOf, parseCodingAgentId } from "./identity.js";

const identity: CodingAgent = {
  id: "custom-agent",
  displayName: "Custom agent",
  aliases: ["custom"],
  home: { defaultPath: [".custom"] }
};

describe("given identities", () => {
  it("resolves aliases only from the given table, including third-party identities and empty slots", () => {
    const identities: ServiceTable<CodingAgent> = { [identity.id]: identity, absent: undefined };
    expect(parseCodingAgentId(" CUSTOM ", identities)).toEqual({ ok: true, value: identity.id });
    expect(parseCodingAgentId("custom", {})).toEqual({ ok: true, value: "custom" });
    expect(parseCodingAgentId("claude", {})).toEqual({ ok: true, value: "claude" });
  });

  it("reads current table entries without caching a prior call's aliases", () => {
    const identities: Record<string, CodingAgent> = { first: identity };
    expect(parseCodingAgentId("custom", identities)).toEqual({ ok: true, value: identity.id });
    identities.second = { ...identity, id: "second-agent" };
    expect(parseCodingAgentId("custom", identities)).toEqual({ ok: true, value: "second-agent" });
  });

  it("takes the caller's home rule before the given identity's rule, and never falls back to built-ins", () => {
    const identities = { [identity.id]: identity };
    const own = { defaultPath: [".own"] };
    expect(homeRuleOf(identity.id, identities)).toBe(identity.home);
    expect(homeRuleOf(identity.id, identities, own)).toBe(own);
    expect(homeRuleOf("missing", {}, own)).toBe(own);
    expect(homeRuleOf("claude-code", {})).toBeUndefined();
    expect(homeRuleOf("missing", {})).toBeUndefined();
    expect(homeRuleOf(identity.id, { [identity.id]: { ...identity, home: undefined } })).toBeUndefined();
  });
});
