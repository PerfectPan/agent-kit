import { AgentKitError } from "@rivus/agent-kit-catalog";

/**
 * A span of time in epoch milliseconds, `since` included and `until` excluded: the `since` and `until` of the usage
 * options and of `summarize`.
 */
export interface CalendarWindow {
  readonly since: number;
  readonly until: number;
}

export interface CalendarWindowOptions {
  /** The end of the window, in epoch milliseconds. */
  readonly now: number;
  /** The IANA time zone whose midnights start the days, such as `Asia/Shanghai`; the host's when absent. */
  readonly timeZone?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Codes of the `AgentKitError`s that cost throws for a caller's mistake: `invalid-window` for `calendarWindow`. */
export type CostErrorCode = "invalid-window";

/**
 * The last `days` calendar days up to `now`: from the midnight that started the day `days − 1` days before the day of
 * `now`, to `now`. `1` is today so far, `7` is today and the six days before, as presence's `usage_1d` and
 * `usage_7d`. The window starts at a midnight of the time zone also when a daylight saving change falls inside it, at
 * the earlier midnight of a day whose clocks turned back over midnight, and at the first moment of a day whose midnight
 * the clocks skipped. A `days` that is not a positive integer, a `now` that is not a finite number and an unknown time
 * zone throw `invalid-window`.
 */
export function calendarWindow(days: number, options: CalendarWindowOptions): CalendarWindow {
  const { now, timeZone } = options;
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(now)) {
    throw new AgentKitError<CostErrorCode>(
      "invalid-window",
      `A calendar window needs a positive whole number of days and a finite now, not ${days} and ${now}`
    );
  }
  let clock: Intl.DateTimeFormat;
  try {
    clock = new Intl.DateTimeFormat("en-US", {
      ...(timeZone === undefined ? {} : { timeZone }),
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
  } catch (cause) {
    throw new AgentKitError<CostErrorCode>("invalid-window", `Unknown time zone "${timeZone}"`, { cause });
  }
  const today = wallClock(clock, now);
  return { since: startOfDay(clock, Date.UTC(today.year, today.month - 1, today.day - (days - 1))), until: now };
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(clock: Intl.DateTimeFormat, time: number): WallClock {
  const parts: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of clock.formatToParts(time)) {
    if (part.type in parts) {
      parts[part.type as keyof WallClock] = Number(part.value);
    }
  }
  return parts;
}

/** The wall-clock time in the clock's time zone at `time`, written as if it were UTC. */
function wallTime(clock: Intl.DateTimeFormat, time: number): number {
  const { year, month, day, hour, minute, second } = wallClock(clock, time);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * The first moment of the day whose midnight, written as if it were UTC, is `midnight`. The time zone's offsets a day
 * before, at and a day after `midnight` cover a clock change on either side of it, and each gives an instant to try.
 * When the clocks turned back over midnight, two instants read as midnight and the earlier one starts the day; when
 * they skipped it, none does, and the latest one, where the clocks jumped, starts the day.
 */
function startOfDay(clock: Intl.DateTimeFormat, midnight: number): number {
  const instants = [midnight - DAY_MS, midnight, midnight + DAY_MS].map(
    (probe) => midnight - (wallTime(clock, probe) - probe)
  );
  const midnights = instants.filter((instant) => wallTime(clock, instant) === midnight);
  return midnights.length > 0 ? Math.min(...midnights) : Math.max(...instants);
}
