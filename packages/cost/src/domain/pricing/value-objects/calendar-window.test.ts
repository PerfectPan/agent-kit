import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vite-plus/test";

import { calendarWindow } from "./calendar-window.js";

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => Date.parse(iso);

describe("calendarWindow", () => {
  it("snaps today to the host's local midnight and ends at now, as presence's windows do", () => {
    const now = at("2026-01-15T10:30:00.000Z");
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    expect(calendarWindow(1, { now })).toEqual({ since: midnight.getTime(), until: now });
    expect(calendarWindow(7, { now }).since).toBe(
      new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - 6).getTime()
    );
  });

  it("starts a 7-day window at midnight six days before today in the given time zone", () => {
    const now = at("2026-01-01T03:00:00.000Z");
    // 11:00 on January 1 in Shanghai (UTC+8), whose midnight is 16:00 UTC the day before.
    expect(calendarWindow(1, { now, timeZone: "Asia/Shanghai" })).toEqual({
      since: at("2025-12-31T16:00:00.000Z"),
      until: now
    });
    expect(calendarWindow(7, { now, timeZone: "Asia/Shanghai" }).since).toBe(at("2025-12-31T16:00:00.000Z") - 6 * DAY);
    expect(calendarWindow(1, { now, timeZone: "UTC" }).since).toBe(at("2026-01-01T00:00:00.000Z"));
    expect(calendarWindow(1, { now, timeZone: "Asia/Kathmandu" }).since).toBe(at("2025-12-31T18:15:00.000Z"));
  });

  it("S72: starts at the first midnight of a day across clock changes, or at the first moment of a day without one", () => {
    // New York moved to UTC−4 on March 8, 2026, so March 4 started at 05:00 UTC, not six times 24 hours earlier.
    const now = at("2026-03-10T12:00:00.000Z");
    expect(calendarWindow(1, { now, timeZone: "America/New_York" }).since).toBe(at("2026-03-10T04:00:00.000Z"));
    expect(calendarWindow(7, { now, timeZone: "America/New_York" }).since).toBe(at("2026-03-04T05:00:00.000Z"));
    // Santiago skipped from 00:00 to 01:00 on September 6, 2026, which started at 01:00 local time.
    expect(calendarWindow(1, { now: at("2026-09-06T12:00:00.000Z"), timeZone: "America/Santiago" }).since).toBe(
      at("2026-09-06T04:00:00.000Z")
    );
    // Gaza turned its clocks back from 01:00 to 00:00 on October 29, 2021, so that day had two midnights.
    expect(calendarWindow(1, { now: at("2021-10-29T12:00:00.000Z"), timeZone: "Asia/Gaza" }).since).toBe(
      at("2021-10-28T21:00:00.000Z")
    );
  });

  it.each([
    [0, {}],
    [1.5, {}],
    [Number.NaN, {}],
    [1, { now: Number.NaN }],
    [1, { timeZone: "Nowhere/Nothing" }]
  ])("throws invalid-window for %s days with %o", (days, options) => {
    try {
      calendarWindow(days, { now: at("2026-01-01T00:00:00.000Z"), ...options });
      expect.unreachable();
    } catch (error) {
      expect(isAgentKitError(error) && error.code).toBe("invalid-window");
    }
  });
});
