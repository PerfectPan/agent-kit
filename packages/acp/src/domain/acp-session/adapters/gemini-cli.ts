import type { AcpProfile } from "../index.js";
import { BASE_ENV } from "./base-env.js";

export const geminiCliAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: "gemini-cli",
  command: "gemini",
  args: ["--experimental-acp"],
  env: [...BASE_ENV, "GEMINI_*", "GOOGLE_*"],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: the ACP flag is --experimental-acp; newer releases may name it differently",
    "unverified: Gemini CLI reads no system prompt from ACP _meta"
  ]
};
