import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";

import { Mascot } from "../../components/mascot.tsx";

/** Sidebar wordmark. Exact matching keeps the landing link inactive on nested docs routes. */
export function DocsBrand({ className }: ComponentProps<"a">) {
  return (
    <Link to="/" className={className} activeOptions={{ exact: true }}>
      <Mascot state="idle" className="docs-mascot" />
      <span className="docs-wordmark">agent-kit</span>
    </Link>
  );
}
