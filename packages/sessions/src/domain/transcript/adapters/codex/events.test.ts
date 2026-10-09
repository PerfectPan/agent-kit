import { describe, expect, it } from "vitest";

import { translateCodexRecords } from "./events.js";

const session = (result: ReturnType<typeof translateCodexRecords>) => {
  if (!result.ok) {
    throw new Error(`unexpected generation: ${JSON.stringify(result.error)}`);
  }
  return result.value.session;
};

describe("translateCodexRecords", () => {
  it("names a session the rollout does not name after its file, else unknown", () => {
    expect(session(translateCodexRecords([], {})).id).toBe("unknown");
    expect(session(translateCodexRecords([], { path: "/r/sessions/2026/01/01/rollout-1.jsonl" })).id).toBe("rollout-1");
    expect(session(translateCodexRecords([], { path: "/r/sessions/.jsonl" })).id).toBe("unknown");
    expect(session(translateCodexRecords([], { sessionId: "from-caller", path: "/r/rollout-1.jsonl" })).id).toBe(
      "from-caller"
    );
  });
});
