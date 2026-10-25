import { useId, useLayoutEffect, useState } from "react";

import type { ToolPath } from "../../lib/layer-functions.ts";

interface Point {
  readonly x: number;
  readonly y: number;
}

function center(host: DOMRect, node: Element, edge: "bottom" | "top"): Point {
  const box = node.getBoundingClientRect();
  return {
    x: box.left + box.width / 2 - host.left,
    y: (edge === "bottom" ? box.bottom : box.top) - host.top
  };
}

function line(from: Point, to: Point): string {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}

export function LayerConnectors({ host, path }: { readonly host: HTMLElement | null; readonly path: ToolPath }) {
  const uid = useId().replaceAll(":", "");
  const [segments, setSegments] = useState<readonly string[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (host === null) {
      return undefined;
    }
    function draw() {
      if (host === null) {
        return;
      }
      const tool = host.querySelector(`[data-node="tool:${path.tool}"]`);
      const fn = host.querySelector(`[data-node="fn:${path.fn}"]`);
      const provider = path.collab ? null : host.querySelector(`[data-node="provider:${path.providerId}"]`);
      const collab = path.collab ? host.querySelector(`[data-node="collab"]`) : null;
      if (!(tool instanceof Element) || !(fn instanceof Element)) {
        return;
      }
      const box = host.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      const from = center(box, tool, "bottom");
      const through = center(box, fn, "top");
      const segments = [line(from, through)];
      if (provider instanceof Element) {
        segments.push(line(center(box, fn, "bottom"), center(box, provider, "top")));
      } else if (collab instanceof Element) {
        segments.push(line(center(box, fn, "bottom"), center(box, collab, "bottom")));
      }
      setSegments(segments);
    }
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    window.addEventListener("resize", draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [host, path.tool, path.fn, path.providerId, path.collab]);

  if (segments.length === 0 || size.width === 0) {
    return null;
  }

  const flow = segments.join(" ");
  return (
    <svg className="layer-lines" width={size.width} height={size.height} aria-hidden="true">
      <defs>
        <marker
          id={`layer-arrow-${uid}`}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      {segments.map((segment) => (
        <path key={segment} className="layer-flow" d={segment} markerEnd={`url(#layer-arrow-${uid})`} />
      ))}
      <path id={`layer-flow-${uid}`} d={flow} fill="none" stroke="none" />
      <circle className="layer-packet" r="3.5">
        <animateMotion key={flow} dur="1.6s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#layer-flow-${uid}`} />
        </animateMotion>
      </circle>
    </svg>
  );
}
