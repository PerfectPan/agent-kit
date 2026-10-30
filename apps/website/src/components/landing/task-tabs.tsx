import type { KeyboardEventHandler, Ref } from "react";

export function TaskTabs<T extends string>({
  lang,
  label,
  items,
  onSelect,
  onKeyDown,
  listRef
}: {
  readonly lang: string;
  readonly label: string;
  readonly items: readonly { readonly id: T; readonly selected: boolean; readonly label: string }[];
  readonly onSelect: (id: T) => void;
  readonly onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  readonly listRef?: Ref<HTMLDivElement>;
}) {
  return (
    // One indicator slides under the selected tab; useSelectedIndicator sets its position as inline variables.
    // Until it has measured (no style attribute yet), the selected tab draws its own underline.
    <div
      ref={listRef}
      className="group/tasks relative flex gap-1 overflow-x-auto border-b border-code-line px-3 pt-3 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-[var(--indicator-width,0)] after:translate-x-[var(--indicator-x,0)] after:rounded-t-[2px] after:bg-honey after:duration-300 after:ease-settle motion-safe:after:transition-[translate,width]"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const { id: task, selected } = item;
        return (
          <button
            key={task}
            type="button"
            role="tab"
            id={`task-${lang}-${task}`}
            className="cursor-pointer rounded-t-control px-3.5 pt-2.25 pb-3 text-ui font-medium whitespace-nowrap text-code-dim transition-[color] duration-200 ease-settle aria-selected:text-code-ink aria-selected:group-[:not([style])]/tasks:shadow-[inset_0_-2px_var(--color-honey)]"
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
