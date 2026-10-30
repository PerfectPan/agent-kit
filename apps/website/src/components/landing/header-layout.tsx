import type { ReactNode } from "react";

import { PageWrap } from "./page-wrap.tsx";

export function HeaderLayout({ brand, children }: { readonly brand: ReactNode; readonly children: ReactNode }) {
  return (
    <header>
      <PageWrap className="flex h-16 items-center justify-between">
        {brand}
        {children}
      </PageWrap>
    </header>
  );
}
