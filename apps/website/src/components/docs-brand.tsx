import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";

import { Mascot } from "./mascot.tsx";

function homeTo(href: string | undefined): "/" | "/zh" {
  return href === "/zh" ? "/zh" : "/";
}

/** Sidebar wordmark. Exact matching keeps the landing link inactive on nested docs routes. */
export function DocsBrand({ href, className }: ComponentProps<"a">) {
  return (
    <Link to={homeTo(href)} className={className} activeOptions={{ exact: true }}>
      <Mascot state="idle" className="docs-mascot" />
      <span className="docs-wordmark">agent-kit</span>
    </Link>
  );
}
