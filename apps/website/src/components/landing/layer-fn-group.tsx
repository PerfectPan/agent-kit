import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

/** A package's functions in the layer diagram; the focused one is filled honey. */
export function LayerFnGroup({
  label,
  onPath,
  names,
  focusedFn,
  bind,
  ...props
}: {
  readonly label: string;
  readonly onPath: boolean;
  readonly names: readonly string[];
  readonly focusedFn: string;
  readonly bind: (id: string) => ComponentProps<"button">;
  readonly "data-node"?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap content-start gap-1.5 rounded-container bg-paper-2 p-3",
        onPath ? "ring-2 ring-ochre/55" : "ring-1 ring-line"
      )}
      {...props}
    >
      <em className="mb-0.5 basis-full text-ui-sm font-semibold text-muted-foreground not-italic">{label}</em>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          data-node={`fn:${name}`}
          className={cn(
            "cursor-pointer rounded-control px-2.25 py-1.25 font-mono text-ui-sm text-ink ring-1 ring-line transition-[color,background-color,box-shadow] duration-200 ease-settle",
            focusedFn === name ? "bg-honey" : "bg-card"
          )}
          aria-pressed={focusedFn === name}
          {...bind(name)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
