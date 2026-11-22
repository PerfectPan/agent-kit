import { describe, expect, it } from "vite-plus/test";

import { SESSION_SUMMARY_VERSION } from "./session-summary.js";

describe("SESSION_SUMMARY_VERSION", () => {
  it("is 4: SQLite summaries include durations, compactions and descendant requests", () => {
    expect(SESSION_SUMMARY_VERSION).toBe(4);
  });
});
