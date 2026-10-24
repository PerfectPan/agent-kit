# Project website

- Status: in review
- Owner: PerfectPan
- Last updated: 2026-10-24
- Paired Plan: [docs/plans/0002-website.md](../plans/0002-website.md)

## Scope

A bilingual (English, Simplified Chinese) website for agent-kit at the default GitHub Pages address, with a landing
page, guides and an API reference for every public entry of `@rivus/agent-kit` and `@rivus/agent-kit-collab`.

Positioning that every page follows: agent-kit is a universal toolkit for agents in general. `@rivus/agent-kit`
connects to one Agent at a time; `@rivus/agent-kit-collab` coordinates many. Copy names today's built-in Agents as
examples only and never states how many Agents are supported; the count lives in the support table. Titles are noun
phrases. "Agent" is capitalized in prose; ids such as `claude-code` stay as written.

Out of scope for this deliverable: the browser playground that reads a dropped session file, a custom domain, search
analytics.

## Scenarios

| ID | Given | When | Then |
| --- | --- | --- | --- |
| W1 | A visitor whose browser prefers Chinese | they open the site root | the landing page shows in Chinese; a switch in the header changes to English and is remembered |
| W2 | The landing page | the visitor picks a task tab and an Agent id in the code demo | the code and the sample output show that Agent's id; an Agent without that capability cannot be picked; "my-agent" shows the provider option |
| W3 | The landing page | the visitor scrolls | they see, in order: the layer between tools and Agents, connection and coordination with each entry's size budget, projects built with agent-kit, the built-in provider table, links to guides and the API reference |
| W4 | Any guide | the visitor switches language | the same guide opens in the other language, or the English page with a note when no translation exists |
| W5 | The API reference | the visitor opens an entry such as `@rivus/agent-kit/sessions` | every exported function, type and constant of that entry is listed with its signature and doc comment, generated from the published declarations |
| W6 | A visitor with `prefers-reduced-motion` | they open the landing page | no mascot animation runs; every state is still readable |
| W7 | A push to `main` that changes the website or a public entry | CI runs | the site builds as static files and deploys to GitHub Pages; a pull request only builds |
| W8 | A 390 px wide screen | any page | nothing overflows horizontally; the code demo scrolls inside its own box |

Sizes shown on the landing page are the `size-limit` budgets from each package's `.size-limit.ts`; the support table
is generated from the shipped provider tables, not written by hand.
