import type { ReactNode } from "react";

export function ChipRow({
  className,
  items,
  onFocusChange,
  children
}: {
  readonly className?: string;
  readonly items: readonly {
    readonly id: string;
    readonly node: string;
    readonly label: string;
    readonly suffix?: string | null;
    readonly className?: string;
    readonly pressed: boolean;
  }[];
  readonly onFocusChange: (id: string | null) => void;
  readonly children?: ReactNode;
}) {
  return (
    <div className={className}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-node={item.node}
          className={item.className}
          aria-pressed={item.pressed}
          tabIndex={0}
          onMouseEnter={() => onFocusChange(item.id)}
          onMouseLeave={() => onFocusChange(null)}
          onFocus={() => onFocusChange(item.id)}
          onBlur={() => onFocusChange(null)}
        >
          {item.label}
          {item.suffix}
        </button>
      ))}
      {children}
    </div>
  );
}
