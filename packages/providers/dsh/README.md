# DeepSeek Harness provider

Private implementation of DeepSeek Harness identity and sessions, bundled into `@rivus/agent-kit`. `facts.ts` owns the home rule and format generation, `layout.ts` owns the session directory layout, and `sessions/` translates the event log. `zstd.ts` reads the concatenated Zstandard frames the harness writes by default. Tests run the shared session conformance suite on plain logs and a separate case on compressed logs. The provider has no discovery, hooks, installation, usage or ACP service.
