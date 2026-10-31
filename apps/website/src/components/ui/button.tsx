import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

const buttonVariants = cva("inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap", {
  variants: {
    variant: {
      default:
        "bg-primary text-primary-foreground duration-200 ease-settle hover:shadow-[0_6px_18px_color-mix(in_srgb,var(--primary)_28%,transparent)] motion-safe:transition-[translate,box-shadow] motion-safe:hover:-translate-y-px",
      card: "bg-card text-card-foreground shadow-card transition-[translate,box-shadow] duration-200 ease-settle hover:-translate-y-px",
      ghost:
        "transition-[color,background-color] duration-200 ease-settle hover:bg-accent hover:text-accent-foreground",
      // Agent chips in the dark code window: a pressed chip turns honey; a disabled one stays hoverable for its title.
      chip: "border border-code-edge bg-code-chip text-code-ink aria-pressed:border-honey",
      // The reader's own agent is drawn as an empty slot until it is picked.
      "chip-slot": "border border-dashed border-honey bg-transparent text-honey aria-pressed:border-solid"
    },
    size: {
      default: "rounded-control px-2.5 py-2",
      lg: "gap-2.5 rounded-control px-6 py-3.25 text-[16px] leading-[normal] font-semibold",
      chip: "rounded-control px-3 py-1.25 font-mono text-ui-sm",
      icon: "size-8 rounded-md"
    }
  },
  compoundVariants: [
    {
      variant: ["chip", "chip-slot"],
      class:
        "transition-[color,background-color,border-color] duration-200 ease-settle aria-pressed:bg-honey aria-pressed:text-ink disabled:cursor-not-allowed disabled:line-through disabled:opacity-35"
    }
  ],
  defaultVariants: {
    variant: "default",
    size: "default"
  }
});

/** A button, or with `asChild` a link or other element that takes the button styles. */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
