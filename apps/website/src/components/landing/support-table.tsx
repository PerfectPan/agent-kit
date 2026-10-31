import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils.ts";

const tableCell = cva("border-b border-line py-2.5", {
  variants: {
    // The first column shrinks to its labels; the rest share the table width.
    column: { label: "w-[1%] pr-2 pl-4 text-left whitespace-nowrap text-ink", value: "px-2 text-center" }
  }
});

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
    <div className="overflow-x-auto rounded-container shadow-card contain-[paint]">
      <table className="w-full border-collapse bg-card font-mono text-ui-sm">
        <thead>
          <tr>
            <th scope="col" className={cn(tableCell({ column: "label" }), "font-sans text-ui-sm font-[650]")}>
              {label}
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(tableCell({ column: "value" }), "font-sans text-ui-sm font-[650] text-ink")}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-[color-mix(in_srgb,var(--color-ochre)_6%,var(--card))]">
              <th scope="row" className={cn(tableCell({ column: "label" }), "font-mono text-ui-sm font-medium")}>
                {row.id}
              </th>
              {row.cells.map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    tableCell({ column: "value" }),
                    "font-mono text-ui",
                    cell.supported ? "text-ink" : "text-ink-2"
                  )}
                >
                  <span aria-hidden="true">{cell.supported ? supportedMark : unsupportedMark}</span>
                  <span className="sr-only">{cell.supported ? supportedLabel : unsupportedLabel}</span>
                </td>
              ))}
            </tr>
          ))}
          <tr className="hover:bg-[color-mix(in_srgb,var(--color-ochre)_6%,var(--card))]">
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
