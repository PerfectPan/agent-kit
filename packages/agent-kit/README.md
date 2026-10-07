# @rivus/agent-kit

Shared building blocks for applications that work with third-party coding agents such as Claude Code, Codex and
Grok: agent identity and home directories, session logs and transcripts, and the `Platform` port through which
files, processes and the environment are injected.

Status: pre-release. See the [repository README](https://github.com/PerfectPan/agent-kit#readme) for the entries
and their status.

```ts
import { splitLines } from "@rivus/agent-kit/platform";
```

ESM-only, side-effect free, Node.js 22.13 or later. Entries other than `/node` and `/testing` also bundle for
browsers. MIT licensed.
