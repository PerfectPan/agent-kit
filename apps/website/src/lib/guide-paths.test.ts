import { expect, it } from "vite-plus/test";

import { ENTRY_GUIDE_SLUG } from "./guide-paths.ts";

const ENTRIES = [
  "/discovery",
  "/sessions",
  "/transcript",
  "/transcript/usage",
  "/cost",
  "/harness/events",
  "/harness",
  "/acp",
  "/redact",
  "/process-lock",
  "/lease",
  "/lanes"
];

it("gives every landing entry a guide slug", () => {
  expect(Object.keys(ENTRY_GUIDE_SLUG).sort()).toEqual([...ENTRIES].sort());
});
