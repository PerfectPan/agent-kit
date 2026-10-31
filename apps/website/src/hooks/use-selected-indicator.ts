import { useEffect, useLayoutEffect, useState } from "react";

function measure(host: HTMLElement) {
  const selected = host.querySelector<HTMLElement>('[aria-selected="true"]');
  if (selected === null) {
    return;
  }
  host.style.setProperty("--indicator-x", `${selected.offsetLeft}px`);
  host.style.setProperty("--indicator-width", `${selected.offsetWidth}px`);
  if (host.dataset["measured"] === undefined) {
    host.dataset["measured"] = "";
  }
}

/**
 * Keeps `--indicator-x` and `--indicator-width` on a list in step with its `[aria-selected="true"]` child, so CSS can
 * slide one indicator between items, and marks the list `data-measured` once they are set. `selectedKey` re-measures
 * after the selection changes; a resize of the list re-measures too.
 */
export function useSelectedIndicator(selectedKey: string) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (host === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => measure(host));
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  useLayoutEffect(() => {
    if (host !== null) {
      measure(host);
    }
  }, [host, selectedKey]);

  return setHost;
}
