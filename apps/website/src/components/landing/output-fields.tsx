import type { CSSProperties } from "react";
import { CodeView, type Token } from "./code-view.tsx";

const TOGGLE =
  "cursor-pointer rounded-control px-2 py-0.5 font-mono text-ui text-code-dim transition-[color,background-color] duration-200 ease-settle aria-pressed:bg-code-chip aria-pressed:text-code-ink";
const HIDDEN = "pointer-events-none invisible";

function swapValue(flash: boolean): string {
  return `justify-self-start rounded-[4px] bg-honey/34 px-1 text-code-ink ${flash ? "motion-safe:animate-swap-in" : ""}`;
}

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
        <span className="inline-flex gap-0.5" role="group" aria-label={label}>
          <button type="button" className={TOGGLE} aria-pressed={!raw} onClick={() => onRawChange(false)}>
            {fieldsLabel}
          </button>
          <button type="button" className={TOGGLE} aria-pressed={raw} onClick={() => onRawChange(true)}>
            {rawLabel}
          </button>
        </span>
      </div>
      {/* Both views share one grid cell, so switching between them keeps the window height. The minimum fits the
          most fields any task shows: 22 px rows, 4 px gaps and the 24 px of vertical padding. */}
      <div
        className="grid min-h-[calc(var(--output-rows,5)*26px+20px)] px-5.5 pt-2 pb-4"
        style={{ "--output-rows": fieldCount } as CSSProperties}
      >
        <dl
          className={`col-start-1 row-start-1 grid content-start gap-1 font-mono text-ui-sm leading-[22px] text-code-ink ${raw ? HIDDEN : ""}`}
          aria-hidden={raw}
        >
          {fields.map((field) => (
            <div
              key={`${flashNonce}-${field.key}`}
              className={`grid grid-cols-[11rem_minmax(0,1fr)] gap-3 narrow:grid-cols-[8rem_minmax(0,1fr)] ${field.flash ? "motion-safe:animate-line-in" : ""}`}
            >
              <dt className="font-normal text-code-dim">{field.key}</dt>
              <dd className={`tabular-nums ${field.swap ? swapValue(field.flash) : "text-code-dim"}`}>{field.value}</dd>
            </div>
          ))}
        </dl>
        <pre
          className={`col-start-1 row-start-1 overflow-x-auto font-mono text-code text-code-dim [font-variant-ligatures:none] ${raw ? "" : HIDDEN}`}
          aria-hidden={!raw}
        >
          <CodeView lines={output} shown={shown} flash={flashOutput} nonce={flashNonce} />
        </pre>
      </div>
    </div>
  );
}
