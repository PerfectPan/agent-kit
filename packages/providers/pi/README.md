# Pi provider

Private implementation of Pi identity, discovery, hooks, installation, sessions and usage, bundled into `@rivus/agent-kit`. Each service has its own export; `facts.ts` owns Pi configuration and `layout.ts` owns its session storage layout. Context imports use SPI entries, and tests run the shared hook, discovery, usage and session conformance checks. Pi has no ACP profile.
