import type { CSSProperties } from "react";

import { cn } from "../../lib/utils.ts";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { CodeView, SWAP_HIGHLIGHT, type Token } from "./code-view.tsx";

export function OutputFields({
  label,
  fieldsLabel,
  rawLabel,
  raw,
  onRawChange,
  fieldCount,
  fields,
  output,
  shown,
  flashOutput,
  flashNonce
}: {
  readonly label: string;
  readonly fieldsLabel: string;
  readonly rawLabel: string;
  readonly raw: boolean;
  readonly onRawChange: (raw: boolean) => void;
  readonly fieldCount: number;
  readonly fields: readonly {
    readonly key: string;
    readonly value: string;
    readonly swap: boolean;
    readonly flash: boolean;
  }[];
  readonly output: readonly (readonly Token[])[];
  readonly shown: number;
  readonly flashOutput: ReadonlySet<number>;
  readonly flashNonce: number;
}) {
  return (
    <div className="border-t border-dashed border-code-edge">
      <div className="flex items-center justify-between px-5.5 pt-3 font-mono text-ui text-code-dim">
        <span>{label}</span>
        <ToggleGroup
          variant="code"
          aria-label={label}
          value={raw ? "raw" : "fields"}
          onValueChange={(value) => onRawChange(value === "raw")}
        >
          <ToggleGroupItem value="fields">{fieldsLabel}</ToggleGroupItem>
          <ToggleGroupItem value="raw">{rawLabel}</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {/* Both views share one grid cell, so switching between them keeps the window height. The field list is as tall
          as the most fields any task shows: 1lh rows with a gap-1 between them. */}
      <div className="grid px-5.5 pt-2 pb-4">
        <dl
          style={{ "--output-rows": fieldCount } as CSSProperties}
          className={cn(
            "col-start-1 row-start-1 grid min-h-[calc(var(--output-rows)*(1lh+var(--spacing))-var(--spacing))] content-start gap-1 font-mono text-ui-sm leading-[22px] text-code-ink",
            raw && "pointer-events-none invisible"
          )}
          aria-hidden={raw}
        >
          {fields.map((field) => (
            <div
              key={`${flashNonce}-${field.key}`}
              className={cn(
                "grid grid-cols-[11rem_minmax(0,1fr)] gap-3 narrow:grid-cols-[8rem_minmax(0,1fr)]",
                field.flash && "motion-safe:animate-line-in"
              )}
            >
              <dt className="font-normal text-code-dim">{field.key}</dt>
              <dd
                className={cn(
                  "tabular-nums",
                  field.swap ? [SWAP_HIGHLIGHT, "justify-self-start px-1"] : "text-code-dim",
                  field.swap && field.flash && "motion-safe:animate-swap-in"
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
        <pre
          className={cn(
            "col-start-1 row-start-1 overflow-x-auto font-mono text-code text-code-dim [font-variant-ligatures:none]",
            !raw && "pointer-events-none invisible"
          )}
          aria-hidden={!raw}
        >
          <CodeView lines={output} shown={shown} flash={flashOutput} nonce={flashNonce} />
        </pre>
      </div>
    </div>
  );
}
