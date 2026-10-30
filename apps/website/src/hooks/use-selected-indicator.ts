import { useLayoutEffect, useState } from "react";

/**
 * Keeps `--indicator-x` and `--indicator-width` on a list in step with its `[aria-selected="true"]` child, so CSS can
 * slide one indicator between items, and marks the list `data-measured` once they are set. `selectedKey` re-measures
 * after the selection changes.
 */
export function useSelectedIndicator(selectedKey: string) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (host === null) {
      return undefined;
    }
    function measure() {
      const selected = host?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (host === null || selected === null || selected === undefined) {
        return;
      }
      host.style.setProperty("--indicator-x", `${selected.offsetLeft}px`);
      host.style.setProperty("--indicator-width", `${selected.offsetWidth}px`);
      host.dataset["measured"] = "";
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host, selectedKey]);

  return setHost;
}
