import { fileURLToPath } from "node:url";
import { readTree } from "../../../testing/test/support.js";

export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  return readTree(fileURLToPath(new URL("fixtures/usage", import.meta.url)), `${home}/.local/share/opencode`);
}
