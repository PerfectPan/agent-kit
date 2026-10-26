import { expect, it } from "vite-plus/test";

import { supportFromProviders } from "./support.ts";

it("treats a missing service as unsupported", () => {
  const [row] = supportFromProviders([
    { id: "cursor", discovery: {}, hooks: {}, install: {}, sessions: undefined, usage: undefined }
  ]);
  expect(row).toEqual({
    id: "cursor",
    discovery: true,
    hooks: true,
    install: true,
    sessions: false,
    usage: false,
    acp: false
  });
});
