import { describe, expect, it } from "vite-plus/test";

import type { SourcePointer } from "../../../transcript/index.js";
import { opencodeMessageUsage } from "./usage.js";

const source: SourcePointer = { file: "msg_a.json", offset: 0, length: 10, line: 1 };

const row = (extra: { readonly id?: string; readonly sessionId?: string; readonly settledAt?: number } = {}) => ({
  ...extra,
  source
});

describe("opencode message usage", () => {
  it("counts a finished assistant message, adding the cache and reasoning back", () => {
    expect(
      opencodeMessageUsage(
        {
          id: "msg_a",
          role: "assistant",
          sessionID: "ses",
          modelID: "m",
          providerID: "p",
          cost: 0.5,
          time: { created: 1000, completed: 2000 },
          tokens: { input: 10, output: 5, reasoning: 2, total: 19, cache: { read: 3, write: 1 } }
        },
        row()
      )
    ).toEqual(
      expect.objectContaining({
        requestId: "msg_a",
        sessionId: "ses",
        model: "m",
        provider: "p",
        costUsd: 0.5,
        costSource: "agent",
        timestamp: 2000,
        usage: {
          inputTokens: 14,
          outputTokens: 7,
          totalTokens: 19,
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
          reasoningTokens: 2
        }
      })
    );
  });

  it("leaves a message out when it is not an object, is no assistant, or has no token counts", () => {
    for (const value of [null, 5, "assistant", { role: "user" }, { role: "assistant", tokens: "10" }]) {
      expect(opencodeMessageUsage(value, row({ settledAt: 1000 }))).toBeUndefined();
    }
  });

  it("reports a running message, and settles it at its creation or the row's time", () => {
    const message = { role: "assistant", tokens: { input: 1, output: 1 } };
    expect(opencodeMessageUsage(message, row())).toBe("running");
    expect(opencodeMessageUsage({ ...message, time: { created: 1000 } }, row())).toBe("running");
    expect(opencodeMessageUsage({ ...message, time: { created: 1000 } }, row({ settledAt: 5000 }))).toMatchObject({
      timestamp: 1000
    });
    expect(opencodeMessageUsage(message, row({ settledAt: 5000 }))).toMatchObject({ timestamp: 5000 });
    expect(
      opencodeMessageUsage({ ...message, time: { created: 1000, completed: "soon" } }, row({ settledAt: 5000 }))
    ).toMatchObject({ timestamp: 1000 });
  });

  it("reads a field of an unexpected type as absent", () => {
    const record = opencodeMessageUsage(
      { role: "assistant", sessionID: 5, tokens: { input: 1, cache: "no" } },
      row({ sessionId: "ses", settledAt: 5000 })
    );
    expect(record).toMatchObject({ sessionId: "ses", usage: { inputTokens: 1 } });
    expect(record).not.toHaveProperty("model");
    const bare = opencodeMessageUsage(
      { role: "assistant", modelID: "", providerID: "", cost: "1", tokens: { input: 1, output: 1 } },
      row({ settledAt: 5000 })
    );
    expect(bare).not.toHaveProperty("model");
    expect(bare).not.toHaveProperty("provider");
    expect(bare).not.toHaveProperty("costUsd");
    expect(
      opencodeMessageUsage({ role: "assistant", tokens: { input: 1, output: 1 } }, row({ settledAt: 5000 }))
    ).toMatchObject({ sessionId: "unknown" });
  });
});
