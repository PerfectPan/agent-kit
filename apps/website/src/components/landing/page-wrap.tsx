import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.ts";

/** Page column shared by the landing header, main content and footer. `asChild` puts it on the child element. */
export function PageWrap({
  className,
  asChild = false,
  ...props
}: ComponentProps<"div"> & { readonly asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp className={cn("mx-auto w-[calc(100%-96px)] max-w-wide phone:w-[calc(100%-32px)]", className)} {...props} />
  );
}
