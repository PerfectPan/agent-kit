import { loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";

import { apiSidebarLabel } from "./api-page.ts";
import { docsUrl } from "./docs-path.ts";
import { i18n } from "./i18n.ts";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    async: true
  }
});

export const source = loader({
  baseUrl: "/docs",
  i18n,
  url: (slugs) => docsUrl(slugs),
  pageTree: {
    transformers: [
      {
        file(node) {
          if (typeof node.name !== "string") {
            return node;
          }
          const label = apiSidebarLabel(node.name);
          return label === undefined ? node : { ...node, name: label };
        }
      }
    ]
  },
  source: docs.toFumadocsSource()
});
