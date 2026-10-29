import type { ReactNode } from "react";

export function EntryTable({
  entries
}: {
  readonly entries: readonly {
    readonly id: string;
    readonly link: ReactNode;
    readonly description: string;
    readonly size: string;
    readonly note?: string;
  }[];
}) {
  return (
    <ul className="entries">
      {entries.map((entry) => (
        <li key={entry.id}>
          {entry.link}
          <span>{entry.description}</span>
          <span className="size">
            <b>{entry.size}</b>
            {entry.note ? <em>{entry.note}</em> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
