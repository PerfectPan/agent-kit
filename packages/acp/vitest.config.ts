import { defineConfig } from "vitest/config";

export default defineConfig({
  // The tests start real agent processes; a loaded CI machine can take seconds to start Node.
  test: { testTimeout: 30_000 }
});
