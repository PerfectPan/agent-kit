# Gemini CLI provider

Private implementation of Gemini CLI identity, discovery, hooks, installation, usage and ACP, bundled into `@rivus/agent-kit`. Each service has its own export; `facts.ts` owns configuration facts and `layout.ts` owns chat storage paths shared by discovery and usage. Context imports use SPI entries. Tests run the shared hook, discovery and usage conformance checks. Gemini CLI has no session adapter; its record parsing stays in `usage.ts`. ACP uses the context's existing `AcpProfile` and `BASE_ENV` SPI exports.
