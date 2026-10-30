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
    <ul>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="relative grid grid-cols-[11rem_minmax(0,1fr)_7.5rem] items-center gap-x-3 gap-y-1.5 border-b border-line py-2.5 text-body-sm text-ink-2 last:border-b-0 narrow:grid-cols-[1fr_auto]"
        >
          {entry.link}
          <span className="narrow:col-span-full narrow:row-2">{entry.description}</span>
          <span className="flex flex-col items-end gap-px">
            <b className="font-mono text-ui font-medium text-ink tabular-nums">{entry.size}</b>
            {entry.note ? (
              <em className="font-sans text-micro text-muted-foreground not-italic">{entry.note}</em>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
