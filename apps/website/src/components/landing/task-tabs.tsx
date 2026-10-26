import type { KeyboardEventHandler } from "react";

export function TaskTabs<T extends string>({
  lang,
  label,
  items,
  onSelect,
  onKeyDown
}: {
  readonly lang: string;
  readonly label: string;
  readonly items: readonly { readonly id: T; readonly selected: boolean; readonly label: string }[];
  readonly onSelect: (id: T) => void;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div className="tasks" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const { id: task, selected } = item;
        return (
          <button
            key={task}
            type="button"
            role="tab"
            id={`task-${lang}-${task}`}
            aria-controls={`task-panel-${lang}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(task)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
