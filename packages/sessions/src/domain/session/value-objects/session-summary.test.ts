import { describe, expect, it } from "vite-plus/test";

import { SESSION_SUMMARY_VERSION } from "./session-summary.js";

describe("SESSION_SUMMARY_VERSION", () => {
  it("is 2: turns and prompts changed value for the same files", () => {
    expect(SESSION_SUMMARY_VERSION).toBe(2);
  });
});
