import { Link } from "@tanstack/react-router";

import { Mascot } from "../../components/mascot.tsx";
import { cn } from "../../lib/utils.ts";

const SIZE = {
  header: { text: "text-[21px]", mascot: "size-7.5" },
  footer: { text: "text-[17px]", mascot: "size-5.5" }
} as const;

/** Wordmark link of the landing header and footer; `group/brand` lets its mascot hop on hover. */
export function BrandLink({ size }: { readonly size: keyof typeof SIZE }) {
  return (
    <Link
      to="/"
      className={cn(
        // A font-size utility also resets the line height, so the size comes first and leading-[normal] wins.
        SIZE[size].text,
        "group/brand flex items-center gap-2.5 leading-[normal] font-[750] tracking-[-0.03em]"
      )}
    >
      <Mascot state="idle" className={SIZE[size].mascot} />
      agent-kit
    </Link>
  );
}
