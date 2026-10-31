import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { DocsBrand } from "./docs-brand.tsx";

/** The repository link, language and theme controls live in DocsSidebarFooter instead of Fumadocs' boxed ones. */
export function baseOptions(): BaseLayoutProps {
  return {
    i18n: false,
    themeSwitch: { enabled: false },
    nav: {
      title: DocsBrand,
      url: "/"
    }
  };
}
