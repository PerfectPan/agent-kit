import type { ReactNode } from "react";

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
    <div className="matrix-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            {columns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.id}</th>
              {row.cells.map((cell) => (
                <td key={cell.id} className={cell.supported ? "y" : "n"}>
                  <span aria-hidden="true">{cell.supported ? supportedMark : unsupportedMark}</span>
                  <span className="sr">{cell.supported ? supportedLabel : unsupportedLabel}</span>
                </td>
              ))}
            </tr>
          ))}
          <tr className="add">
            <td colSpan={columns.length + 1}>{footer}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
