import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

// Variants are named for the surface the group sits on. shadcn passes the variant from the group to its items through
// React context; components/ may not read context (architecture.test.ts), so each item takes the variant itself.
const toggleGroupVariants = cva("inline-flex", {
  variants: {
    variant: {
      paper: "rounded-control bg-secondary p-0.75",
      sidebar: "rounded-lg bg-secondary p-0.5",
      code: "gap-0.5"
    }
  }
});

const toggleVariants = cva("cursor-pointer transition-[color,background-color,box-shadow] duration-200 ease-settle", {
  variants: {
    variant: {
      paper:
        "rounded-control px-2.75 py-1 text-ui-sm font-medium text-ink-2 data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgb(42_33_30/0.1)]",
      sidebar:
        "rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgb(42_33_30/0.1)]",
      code: "rounded-control px-2 py-0.5 font-mono text-ui text-code-dim data-[state=on]:bg-code-chip data-[state=on]:text-code-ink"
    }
  }
});

/** A single-choice group: items are radios, arrow keys move between them. */
export function ToggleGroup({
  className,
  variant,
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type"> & VariantProps<typeof toggleGroupVariants>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      type="single"
      className={cn(toggleGroupVariants({ variant }), className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  variant,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants({ variant }), className)}
      {...props}
    />
  );
}
