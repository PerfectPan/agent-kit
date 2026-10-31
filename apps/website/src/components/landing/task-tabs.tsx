import type { Ref } from "react";

import { TabsList, TabsTrigger } from "../ui/tabs.tsx";

export function TaskTabs<T extends string>({
  lang,
  label,
  items,
  listRef
}: {
  readonly lang: string;
  readonly label: string;
  readonly items: readonly { readonly id: T; readonly label: string }[];
  readonly listRef?: Ref<HTMLDivElement>;
}) {
  return (
    <TabsList ref={listRef} aria-label={label}>
      {/* All tabs control the one panel that CodeWindow renders, so the ids replace the per-value ids Radix makes. */}
      {items.map((item) => (
        <TabsTrigger key={item.id} value={item.id} id={`task-${lang}-${item.id}`} aria-controls={`task-panel-${lang}`}>
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
