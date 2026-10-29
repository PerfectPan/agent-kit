import { useEffect, useEffectEvent, useRef } from "react";

export interface TimedEvent<T> {
  readonly delay: number;
  readonly event: T;
}

/** A new trigger cancels the previous sequence. Initial markup stays settled. */
export function useTimedEvents<T>(
  trigger: unknown,
  sequence: () => readonly TimedEvent<T>[],
  dispatch: (event: T) => void
): void {
  const first = useRef(true);
  const start = useEffectEvent(() => {
    const timers: number[] = [];
    for (const { delay, event } of sequence()) {
      if (delay === 0) {
        dispatch(event);
      } else {
        timers.push(window.setTimeout(() => dispatch(event), delay));
      }
    }
    return timers;
  });
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    const timers = start();
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [trigger]);
}
