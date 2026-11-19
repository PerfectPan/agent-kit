---
"@rivus/agent-kit": patch
---

`redactText` hides more credentials:

- Stripe (`sk_live_`, `rk_test_`), GitLab (`glpat-`), Hugging Face (`hf_`), and Google (`AIza`) keys, JWTs, and Slack webhook URLs.
- The value of credential assignments (`PASSWORD=`, `client_secret:`, `GITHUB_TOKEN=`, `SECRET_KEY=`, `X-Api-Key:`, `aws_secret_access_key =`, `password: str = "…"`), raw, quoted, or JSON-escaped.
- The value after `Authorization: Bearer|Basic|Token`, and a standalone `Bearer` value of 16 or more characters that holds a digit.
- The password of URL userinfo.

After a credential name, types, flags, placeholders (`$…`, `<…>`, `env:…`), numbers, dictionary labels, values without a digit in code (`token = getToken()`), and calls or literals (`gen2()`, `corev1.Secret{}`) stay as they are.
