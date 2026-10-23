---
"@rivus/agent-kit": patch
---

Hide the URL-encoded home (`%2Fu%2Fme`), the project slug and the slash-less home right after a JSON escape (`\n`), URL encoding (`%2F`) or an ANSI colour sequence (`\u001b[32m`) in raw text, where the escape's last letter or digit kept the spelling visible.
