import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

// The site's only tabs sit on top of the dark code window, so these carry that look rather than shadcn's pill tabs.

export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

/**
 * One honey indicator slides under the selected trigger from the `--indicator-x` and `--indicator-width` variables
 * that useSelectedIndicator sets on the list, which also marks the list `data-measured`. Until then the selected
 * trigger draws its own underline.
 */
export function TabsList({ className, onPointerDown, onKeyDown, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      // Radix focuses a trigger from script on mousedown, which Chrome treats as keyboard focus when nothing had focus
      // yet, so a click could draw the focus ring. `data-pointer` remembers that the last input was a pointer.
      onPointerDown={(event) => {
        event.currentTarget.dataset["pointer"] = "";
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        delete event.currentTarget.dataset["pointer"];
        onKeyDown?.(event);
      }}
      className={cn(
        "group/tabs relative flex gap-1 overflow-x-auto border-b border-code-line px-3 pt-3 after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-(--indicator-width,0) after:translate-x-(--indicator-x,0) after:rounded-t-[2px] after:bg-honey after:duration-300 after:ease-settle motion-safe:after:transition-[translate,width]",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "cursor-pointer rounded-t-control outline-none focus-visible:group-not-data-pointer/tabs:outline-2 focus-visible:group-not-data-pointer/tabs:outline-solid focus-visible:group-not-data-pointer/tabs:-outline-offset-2 focus-visible:group-not-data-pointer/tabs:outline-honey px-3.5 pt-2.25 pb-3 text-ui font-medium whitespace-nowrap text-code-dim transition-[color] duration-200 ease-settle aria-selected:text-code-ink aria-selected:group-[:not([data-measured])]/tabs:shadow-[inset_0_-2px_var(--color-honey)]",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent(props: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" {...props} />;
}
