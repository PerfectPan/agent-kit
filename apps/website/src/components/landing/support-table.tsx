import type { ReactNode } from "react";

const CELL = "border-b border-line py-2.5";
const VALUE_CELL = `${CELL} px-2 text-center`;
// The first column shrinks to its labels; the rest share the table width.
const FIRST_CELL = `${CELL} w-[1%] pr-2 pl-4 text-left whitespace-nowrap text-ink`;
const ROW = "hover:bg-[color-mix(in_srgb,var(--color-ochre)_6%,var(--color-card))]";

export function SupportTable({
  label,
  columns,
  rows,
  supportedLabel,
  unsupportedLabel,
  supportedMark,
  unsupportedMark,
  footer
}: {
  readonly label: string;
  readonly columns: readonly { readonly id: string; readonly label: string }[];
  readonly rows: readonly {
    readonly id: string;
    readonly cells: readonly { readonly id: string; readonly supported: boolean }[];
  }[];
  readonly supportedLabel: string;
  readonly unsupportedLabel: string;
  readonly supportedMark: string;
  readonly unsupportedMark: string;
  readonly footer: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-container shadow-card [contain:paint]">
      <table className="w-full border-collapse bg-card font-mono text-ui-sm">
        <thead>
          <tr>
            <th scope="col" className={`${FIRST_CELL} font-sans text-ui-sm font-[650]`}>
              {label}
            </th>
            {columns.map((column) => (
              <th key={column.id} scope="col" className={`${VALUE_CELL} font-sans text-ui-sm font-[650] text-ink`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={ROW}>
              <th scope="row" className={`${FIRST_CELL} font-mono text-ui-sm font-medium`}>
                {row.id}
              </th>
              {row.cells.map((cell) => (
                <td
                  key={cell.id}
                  className={`${VALUE_CELL} font-mono text-ui ${cell.supported ? "text-ink" : "text-ink-2"}`}
                >
                  <span aria-hidden="true">{cell.supported ? supportedMark : unsupportedMark}</span>
                  <span className="sr-only">{cell.supported ? supportedLabel : unsupportedLabel}</span>
                </td>
              ))}
            </tr>
          ))}
          <tr className={ROW}>
            <td
              colSpan={columns.length + 1}
              className="w-[1%] py-2.5 pr-2 pl-4 text-left font-sans font-semibold whitespace-nowrap text-ochre"
            >
              {footer}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
