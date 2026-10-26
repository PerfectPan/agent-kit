import type { ReactNode } from "react";

export function HeaderLayout({ brand, children }: { readonly brand: ReactNode; readonly children: ReactNode }) {
  return (
    <header className="nav">
      <div className="wrap">
        {brand}
        {children}
      </div>
    </header>
  );
}
