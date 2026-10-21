# Cursor provider

Private implementation of Cursor identity, discovery, hooks and installation, bundled into `@rivus/agent-kit`. Each service has its own export; `facts.ts` owns its paths, commands and host markers. Context imports use SPI entries. Tests run hook and discovery conformance; cross-agent host-sniffing tests stay in testing and harness. Cursor has no verified identity home rule, session adapter, usage decoder or ACP profile.
