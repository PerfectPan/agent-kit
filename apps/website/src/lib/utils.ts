import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge only knows Tailwind's default scales. Without these names it reads `text-ui` as a colour and drops
// it next to `text-ink`, so every size, shadow, radius, easing and animation that theme.css adds is listed here.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "section", "component", "body-sm", "micro", "ui", "ui-sm", "code"],
      shadow: ["card", "window"],
      radius: ["control", "container"],
      ease: ["settle", "enter"],
      animate: [
        "enter",
        "pop",
        "line-in",
        "swap-in",
        "blink",
        "blink-fast",
        "hop",
        "hop-hover",
        "hop-sm",
        "bob",
        "flap",
        "shake"
      ],
      container: ["wide", "read"]
    }
  }
});

/** Joins class names and lets a later utility replace an earlier one of the same property. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
