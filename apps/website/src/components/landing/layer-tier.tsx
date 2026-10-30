import type { ReactNode } from "react";

/** One labelled row of the layer diagram: tools, toolkit or providers. */
export function LayerTier({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="relative z-1 grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-5 gap-y-4 phone:grid-cols-[1fr] phone:gap-2">
      <b className="pt-2 text-right text-ui font-semibold text-muted-foreground phone:pt-0 phone:text-left">{label}</b>
      {children}
    </div>
  );
}
