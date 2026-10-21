import { expect, it } from "vite-plus/test";

import { readHookEvent } from "../src/harness/events.js";
import { builtinProviders } from "../src/providers.js";
import { acpTable } from "../src/providers/acp.js";
import { discoveryTable } from "../src/providers/discovery.js";
import { hooksTable } from "../src/providers/hooks.js";
import { identityTable } from "../src/providers/identity.js";
import { installTable } from "../src/providers/install.js";
import { sessionsTable } from "../src/providers/sessions.js";
import { unsupported } from "../src/providers/unsupported.js";
import { usageTable } from "../src/providers/usage.js";

const tables = {
  identity: identityTable(),
  discovery: discoveryTable(),
  hooks: hooksTable(),
  install: installTable(),
  sessions: sessionsTable(),
  usage: usageTable(),
  acp: acpTable()
};
const services = ["identity", "discovery", "hooks", "install", "sessions", "usage", "acp"] as const;
const ids = Object.keys(tables.identity).toSorted();

it("lets a later descriptor replace an earlier implementation of the same service", () => {
  const earlier = { ...tables.hooks.codex! };
  const later = { ...earlier };
  expect(
    hooksTable([
      { id: "codex", hooks: earlier },
      { id: "codex", hooks: later }
    ]).codex
  ).toBe(later);
});

it("puts grok before cursor in the shell hooks table and resolves competing payload markers in that order", () => {
  const ordered = Object.keys(tables.hooks);
  expect(ordered.indexOf("grok")).toBeLessThan(ordered.indexOf("cursor"));
  expect(readHookEvent("claude-code", { hookEventName: "SessionStart", cursor_version: "test" }, {}).agent).toBe(
    "grok"
  );
});

it("accounts for every built-in service with an implementation or an unsupported reason", () => {
  expect(Object.keys(unsupported).toSorted()).toEqual(ids);
  for (const id of ids) {
    for (const service of services) {
      const reason = unsupported[id]?.[service];
      if (tables[service][id] === undefined) {
        expect(reason, `${id}/${service}`).toEqual(expect.stringMatching(/\S/));
      } else {
        expect(reason, `${id}/${service}`).toBeUndefined();
      }
    }
  }
});

it("exports builtinProviders with the same ids and services as the individual tables", () => {
  expect(builtinProviders.map((provider) => provider.id).toSorted()).toEqual(ids);
  for (const service of services) {
    expect(Object.keys(tables[service]).every((id) => ids.includes(id))).toBe(true);
    for (const provider of builtinProviders) {
      expect(provider[service], `${provider.id}/${service}`).toBe(tables[service][provider.id]);
    }
  }
});
