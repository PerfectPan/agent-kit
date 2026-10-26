import { createRouter } from "@tanstack/react-router";

import { normalizeBasePath } from "./lib/site.ts";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  const router = createRouter({
    routeTree,
    basepath: normalizeBasePath(import.meta.env.BASE_URL),
    scrollRestoration: true
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
