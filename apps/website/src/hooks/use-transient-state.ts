import { useEffect, useState } from "react";

/** Setting the same value again does not extend an already running delay. */
export function useTransientState<T>(fallback: T, delay: number) {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    if (Object.is(value, fallback)) {
      return undefined;
    }
    const timer = window.setTimeout(() => setValue(fallback), delay);
    return () => window.clearTimeout(timer);
  }, [value, fallback, delay]);
  return [value, setValue] as const;
}
