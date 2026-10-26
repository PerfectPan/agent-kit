import { useEffect, useEffectEvent, useRef, useState, type FocusEvent } from "react";

export function useAutoplay({
  enabled,
  stepKey,
  idleMs,
  intervalMs,
  onStep
}: {
  readonly enabled: boolean;
  readonly stepKey: unknown;
  readonly idleMs: number;
  readonly intervalMs: number;
  readonly onStep: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const lastUserAt = useRef(Date.now());
  const advance = useEffectEvent(onStep);

  useEffect(() => {
    if (!enabled || paused) {
      return undefined;
    }
    const elapsed = Date.now() - lastUserAt.current;
    const delay = elapsed < idleMs ? idleMs - elapsed : intervalMs;
    const timer = window.setTimeout(advance, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, paused, stepKey, idleMs, intervalMs]);

  function markUser() {
    lastUserAt.current = Date.now();
  }

  return {
    markUser,
    interactionProps: {
      onMouseEnter: () => setPaused(true),
      onMouseLeave: () => setPaused(false),
      onFocusCapture: () => setPaused(true),
      onBlurCapture: (event: FocusEvent<HTMLDivElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setPaused(false);
        }
      }
    }
  };
}
