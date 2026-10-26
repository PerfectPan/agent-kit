import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { DocsBrand } from "./docs-brand.tsx";
import { GITHUB_URL } from "../landing/index.ts";

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: GITHUB_URL,
    nav: {
      title: DocsBrand,
      url: "/"
    }
  };
}
