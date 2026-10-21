# Pi provider

Private implementation of Pi identity, discovery, hooks, installation and usage, bundled into `@rivus/agent-kit`. Each service has its own export; `facts.ts` owns Pi configuration and `layout.ts` owns its session storage layout. Context imports use SPI entries, and tests run the shared hook, discovery and usage conformance checks. Pi has no session adapter or ACP profile.
