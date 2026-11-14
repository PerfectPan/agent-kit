import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { agentEnv } from "../src/acp.js";
import { builtinProviders } from "../src/providers.js";

const profile = builtinProviders.find((provider) => provider.id === "pi")!.acp!;

describe("pi launch environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forwards the provider credentials pi reads from the environment", () => {
    vi.stubEnv("ZAI_API_KEY", "zai");
    vi.stubEnv("CEREBRAS_API_KEY", "cerebras");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "azure");
    vi.stubEnv("MOONSHOT_API_KEY", "moonshot");
    vi.stubEnv("HF_TOKEN", "huggingface");
    vi.stubEnv("COPILOT_GITHUB_TOKEN", "copilot");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "aws-id");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "aws-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "aws-session");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_DEFAULT_REGION", "us-west-2");
    vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/pi");
    vi.stubEnv("AWS_WEB_IDENTITY_TOKEN_FILE", "/token/file");
    const env = agentEnv(profile, process.env);
    for (const [name, value] of Object.entries({
      ZAI_API_KEY: "zai",
      CEREBRAS_API_KEY: "cerebras",
      AZURE_OPENAI_API_KEY: "azure",
      MOONSHOT_API_KEY: "moonshot",
      HF_TOKEN: "huggingface",
      COPILOT_GITHUB_TOKEN: "copilot",
      AWS_ACCESS_KEY_ID: "aws-id",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      AWS_SESSION_TOKEN: "aws-session",
      AWS_REGION: "us-east-1",
      AWS_DEFAULT_REGION: "us-west-2",
      AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/pi",
      AWS_WEB_IDENTITY_TOKEN_FILE: "/token/file"
    })) {
      expect(env[name]).toBe(value);
    }
  });

  it("keeps variables pi does not read out of the agent environment", () => {
    vi.stubEnv("GITHUB_TOKEN", "unrelated");
    vi.stubEnv("VERCEL_TOKEN", "unrelated");
    const env = agentEnv(profile, process.env);
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.VERCEL_TOKEN).toBeUndefined();
  });
});
