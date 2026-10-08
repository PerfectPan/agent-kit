# Smoke tests

Tests against the coding agents installed on this machine. They start the agents' real programs with the current
user's login, so they may spend tokens; CI never runs them (the project's `test` script is empty).

```bash
node common/scripts/install-run-rush.js install
cd tests/smoke
AGENT_KIT_SMOKE_AGENTS=claude-code,codex,opencode,gemini-cli,grok npm run smoke
```

`AGENT_KIT_SMOKE_AGENTS` names the agents to run, by `CodingAgentId`; the others are skipped. Each agent needs its ACP
program on `PATH`: `claude-agent-acp`, `codex-acp`, `opencode`, `gemini` and `grok`. An agent gets only the variables
its profile lists in `builtinAcpProfiles`, taken from the shell's environment.

For each agent, `acp.smoke.test.ts` probes it (a trial session reports `ready` or `needs-login`), sends one prompt
with a system prompt and checks the answer, and leaves a long turn early to check that the cancel settles.
