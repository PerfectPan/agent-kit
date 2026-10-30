import type { ReactNode } from "react";

import { WRAP } from "./wrap.ts";

export function HeaderLayout({ brand, children }: { readonly brand: ReactNode; readonly children: ReactNode }) {
  return (
    <header>
      <div className={`${WRAP} flex h-16 items-center justify-between`}>
        {brand}
        {children}
      </div>
    </header>
  );
}
