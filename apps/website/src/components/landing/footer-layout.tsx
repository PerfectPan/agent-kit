import type { ReactNode } from "react";

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
    <footer>
      <div className="wrap">
        {brand}
        <span>{summary}</span>
        <nav>{children}</nav>
      </div>
    </footer>
  );
}
