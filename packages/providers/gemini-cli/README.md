# Gemini CLI provider

Private implementation of Gemini CLI identity, discovery, hooks, installation, sessions, usage and ACP, bundled into `@rivus/agent-kit`. Each service has its own export; `facts.ts` owns configuration facts and `layout.ts` owns chat storage paths shared by discovery and usage. Context imports use SPI entries. Tests run the shared hook, discovery, session and usage conformance checks. `sessions.ts` reads the chat recordings as transcripts, with the record parsing in `sessions/records.ts`. ACP uses the context's existing `AcpProfile` and `BASE_ENV` SPI exports.
