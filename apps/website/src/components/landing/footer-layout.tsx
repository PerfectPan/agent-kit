import type { ReactNode } from "react";

import { PageWrap } from "./page-wrap.tsx";

export function FooterLayout({
  brand,
  summary,
  children
}: {
  readonly brand: ReactNode;
  readonly summary: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <footer className="mt-7 border-t border-line pt-6 pb-9 text-[14px] text-ink-2">
      <PageWrap className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        {brand}
        <span>{summary}</span>
        <nav className="flex gap-5">{children}</nav>
      </PageWrap>
    </footer>
  );
}
