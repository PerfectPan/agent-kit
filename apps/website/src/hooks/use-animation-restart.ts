import { useEffect, useState } from "react";

export function useAnimationRestart(signal: string | undefined): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (signal === undefined) {
      return undefined;
    }
    setActive(false);
    const frame = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(frame);
  }, [signal]);
  return active;
}
