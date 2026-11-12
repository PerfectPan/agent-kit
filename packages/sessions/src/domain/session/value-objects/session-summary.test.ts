import { describe, expect, it } from "vite-plus/test";

import { SESSION_SUMMARY_VERSION } from "./session-summary.js";

describe("SESSION_SUMMARY_VERSION", () => {
  it("is 3: Grok requests count model calls rather than turns", () => {
    expect(SESSION_SUMMARY_VERSION).toBe(3);
  });
});
