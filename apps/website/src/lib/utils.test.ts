import { expect, it } from "vite-plus/test";

import { cn } from "./utils.ts";

it("keeps a theme text size next to a text colour", () => {
  expect(cn("text-ui text-ink", "text-body-sm")).toBe("text-ink text-body-sm");
  expect(cn("shadow-card", "shadow-window")).toBe("shadow-window");
  expect(cn("rounded-control", "rounded-md")).toBe("rounded-md");
});
