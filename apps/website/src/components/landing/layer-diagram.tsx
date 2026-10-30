import { useId } from "react";
import type { Point, Segment } from "../../lib/geometry.ts";

function line(from: Point, to: Point): string {
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}

export function LayerDiagram({
  points,
  size
}: {
  readonly points: readonly Segment[];
  readonly size: { readonly width: number; readonly height: number };
}) {
  const uid = useId().replaceAll(":", "");
  const segments = points.map(({ from, to }) => line(from, to));
  if (segments.length === 0 || size.width === 0) {
    return null;
  }

  const flow = segments.join(" ");
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
      width={size.width}
      height={size.height}
      aria-hidden="true"
    >
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
          <path className="fill-ochre" d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      {segments.map((segment) => (
        <path
          key={segment}
          className="fill-none stroke-ochre stroke-2"
          d={segment}
          markerEnd={`url(#layer-arrow-${uid})`}
        />
      ))}
      <path id={`layer-flow-${uid}`} d={flow} fill="none" stroke="none" />
      <circle className="fill-ochre motion-reduce:hidden" r="3.5">
        <animateMotion key={flow} dur="1.6s" repeatCount="indefinite" rotate="auto">
          <mpath href={`#layer-flow-${uid}`} />
        </animateMotion>
      </circle>
    </svg>
  );
}
