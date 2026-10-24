import { useEffect, useState } from "react";

import { text, type Lang } from "../../lib/landing-copy.ts";

export function CopyButton({ value, lang }: { readonly value: string; readonly lang: Lang }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <button
      type="button"
      className={copied ? "copy is-copied" : "copy"}
      aria-label={text(lang, copied ? "copied" : "copyInstall")}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
          },
          () => {
            setCopied(false);
          }
        );
      }}
    >
      {text(lang, copied ? "copied" : "copy")}
    </button>
  );
}
