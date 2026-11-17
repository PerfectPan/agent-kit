# @rivus/agent-kit-provider-agy

Antigravity CLI (`agy`) for @rivus/agent-kit: the identity, the discovery probe recipe and the ACP profile. A
private internal package bundled into the shell; see the repository README for the support matrix.

What this package reads about a 1.5.10 CLI, verified against the binary on this machine:

- `agy acp` starts the Agent Client Protocol stdio server; the profile launches it and lets hosts answer
  permission requests over the protocol instead of passing `--dangerously-skip-permissions`.
- Files live under the Gemini directory `~/.gemini` (`ANTIGRAVITY_GEMINI_DIR` or `--gemini-dir` relocates it),
  with the CLI's own state under `~/.gemini/antigravity-cli`.

Not supported yet, recorded in the shell's `unsupported` table:

- `hooks`/`install`: hooks are named entries in `hooks.json` files, a schema the CLI does not document.
- `sessions`/`usage`: conversations are one SQLite database per conversation of protobuf payloads
  (`antigravity-cli/conversations/<uuid>.db`) with no published schema; `history.jsonl` and the relational
  summaries database carry no message bodies or token counts.
