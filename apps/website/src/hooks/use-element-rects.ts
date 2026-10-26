import { useLayoutEffect, useState } from "react";

import type { Point, Segment } from "../lib/geometry.ts";

interface Connection {
  readonly from: string;
  readonly to: string;
  readonly fromEdge: "bottom" | "top";
  readonly toEdge: "bottom" | "top";
}

function center(host: DOMRect, node: Element, edge: "bottom" | "top"): Point {
  const box = node.getBoundingClientRect();
  return {
    x: box.left + box.width / 2 - host.left,
    y: (edge === "bottom" ? box.bottom : box.top) - host.top
  };
}

export function useElementRects(connections: readonly Connection[]) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [segments, setSegments] = useState<readonly Segment[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    if (host === null) {
      return undefined;
    }
    function draw() {
      if (host === null) {
        return;
      }
      const nodes = connections.map((connection) => ({
        ...connection,
        fromNode: host.querySelector(connection.from),
        toNode: host.querySelector(connection.to)
      }));
      if (!nodes[0]?.fromNode || !nodes[0].toNode) {
        return;
      }
      const box = host.getBoundingClientRect();
      setSize({ width: box.width, height: box.height });
      setSegments(
        nodes.flatMap(({ fromNode, toNode, fromEdge, toEdge }) =>
          fromNode instanceof Element && toNode instanceof Element
            ? [{ from: center(box, fromNode, fromEdge), to: center(box, toNode, toEdge) }]
            : []
        )
      );
    }
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    window.addEventListener("resize", draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [host, connections]);

  return { ref: setHost, segments, size };
}
