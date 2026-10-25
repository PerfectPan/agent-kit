import { createRouter } from "@tanstack/react-router";

import { SITE_BASE_PATH } from "./lib/site.ts";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  const router = createRouter({
    routeTree,
    basepath: SITE_BASE_PATH,
    scrollRestoration: true
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
