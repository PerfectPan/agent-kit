import type { CSSProperties } from "react";
import { CodeView, type Token } from "./code-view.tsx";

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
    <div className="result">
      <div className="file">
        <span>{label}</span>
        <span className="output-toggle" role="group" aria-label={label}>
          <button type="button" aria-pressed={!raw} onClick={() => onRawChange(false)}>
            {fieldsLabel}
          </button>
          <button type="button" aria-pressed={raw} onClick={() => onRawChange(true)}>
            {rawLabel}
          </button>
        </span>
      </div>
      <div className="result-body" style={{ "--output-rows": fieldCount } as CSSProperties}>
        <dl className={raw ? "fields is-hidden" : "fields"} aria-hidden={raw}>
          {fields.map((field) => (
            <div
              key={`${flashNonce}-${field.key}`}
              className={
                [field.swap ? "is-swap" : undefined, field.flash ? "flash" : undefined]
                  .filter((name) => name !== undefined)
                  .join(" ") || undefined
              }
            >
              <dt>{field.key}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
        <pre className={raw ? undefined : "is-hidden"} aria-hidden={!raw}>
          <CodeView lines={output} shown={shown} flash={flashOutput} nonce={flashNonce} />
        </pre>
      </div>
    </div>
  );
}
