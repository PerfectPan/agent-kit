import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";

import { Mascot } from "../../components/mascot.tsx";

/** Sidebar wordmark. Exact matching keeps the landing link inactive on nested docs routes. */
export function DocsBrand({ className }: ComponentProps<"a">) {
  return (
    <Link to="/" className={`group/brand ${className ?? ""}`} activeOptions={{ exact: true }}>
      <Mascot state="idle" quiet className="size-[1.7rem] flex-none" />
      <span className="tracking-[-0.03em]">agent-kit</span>
    </Link>
  );
}
