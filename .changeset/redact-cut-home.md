---
"@rivus/agent-kit": patch
---

`redactText` also hides a home directory that a cut left partial at the end of a text. Session titles and first prompts are cut to 80 and 500 characters before anything redacts them, so a cut inside `/u/alice` used to leave `/u/ali`. Every spelling is checked: native, JSON-escaped, URL-encoded, the project slug, `~user`, and the Windows and MSYS forms. This covers user names with `-`, `.` or spaces. An end that holds the parent directory and at least one character of the user name, or two for a one-segment home and `~user`, reads `~`.
