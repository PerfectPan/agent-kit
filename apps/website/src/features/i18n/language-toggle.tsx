import type { ComponentProps } from "react";

import { useLanguage } from "../../hooks/use-language.ts";
import type { Lang } from "../../lib/language.ts";
import { ToggleGroup, ToggleGroupItem } from "../../components/ui/toggle-group.tsx";

const GROUP_LABEL: Record<Lang, string> = { en: "Language", zh: "语言" };

/**
 * Switches the site language. `lang` is the language the toggle is drawn in; it defaults to the current one, and the
 * landing page passes the language of each prerendered tree.
 */
export function LanguageToggle({
  lang,
  variant,
  className
}: {
  readonly lang?: Lang;
  readonly variant: NonNullable<ComponentProps<typeof ToggleGroup>["variant"]>;
  readonly className?: string;
}) {
  const language = useLanguage();
  const shown = lang ?? language.lang;
  return (
    <ToggleGroup
      variant={variant}
      className={className}
      aria-label={GROUP_LABEL[shown]}
      value={shown}
      onValueChange={(value) => {
        if (value === "en" || value === "zh") {
          language.setLang(value);
        }
      }}
    >
      <ToggleGroupItem value="en">EN</ToggleGroupItem>
      <ToggleGroupItem value="zh">中文</ToggleGroupItem>
    </ToggleGroup>
  );
}
