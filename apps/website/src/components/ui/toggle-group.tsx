import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

// Variants are named for the surface the group sits on. shadcn passes the variant from the group to its items through
// React context; components/ may not read context (architecture.test.ts), so the group styles its items with `*:`.
const toggleGroupVariants = cva("inline-flex", {
  variants: {
    variant: {
      paper:
        "rounded-control bg-secondary p-0.75 *:rounded-control *:px-2.75 *:py-1 *:text-ui-sm *:font-medium *:text-ink-2 *:data-[state=on]:bg-card *:data-[state=on]:text-ink *:data-[state=on]:shadow-thumb",
      sidebar:
        "rounded-lg bg-secondary p-0.5 *:rounded-md *:px-2.5 *:py-1 *:text-xs *:font-medium *:text-muted-foreground *:data-[state=on]:bg-background *:data-[state=on]:text-foreground *:data-[state=on]:shadow-thumb",
      code: "gap-0.5 *:rounded-control *:px-2 *:py-0.5 *:font-mono *:text-ui *:text-code-dim *:data-[state=on]:bg-code-chip *:data-[state=on]:text-code-ink"
    }
  }
});

/**
 * A single-choice group: items are radios, arrow keys move between them. Pressing the selected item keeps it selected;
 * Radix would clear the value, so `onValueChange` only receives a new choice.
 */
export function ToggleGroup({
  className,
  variant,
  onValueChange,
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type"> & VariantProps<typeof toggleGroupVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      type="single"
      className={cn(toggleGroupVariants({ variant }), className)}
      onValueChange={(value) => {
        if (value !== "") {
          onValueChange?.(value);
        }
      }}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "cursor-pointer transition-[color,background-color,box-shadow] duration-200 ease-settle",
        className
      )}
      {...props}
    />
  );
}
