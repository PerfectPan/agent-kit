# Project website

- Status: in review
- Owner: PerfectPan
- Last updated: 2026-10-25
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
| W1 | A visitor whose browser prefers Chinese | they open the site root | the landing page at `/` shows in Chinese; a switch in the header changes to English in place, keeps the URL, and is remembered |
| W2 | The landing page | the visitor picks a task tab and an Agent id in the code demo | the code and the sample output show that Agent's id; an Agent without that capability cannot be picked; "my-agent" shows the provider option |
| W3 | The landing page | the visitor scrolls | they see, in order: the layer between tools and Agents, connection and coordination with each entry's size budget, projects built with agent-kit, the built-in provider table, links to guides and the API reference |
| W4 | Any guide | the visitor switches language | the same URL shows the other language, or the English page with a note when no translation exists |
| W5 | The API reference | the visitor opens an entry such as `@rivus/agent-kit/sessions` | every exported function, type and constant of that entry is listed with its signature and doc comment, generated from the published declarations |
| W6 | A visitor with `prefers-reduced-motion` | they open the landing page | no mascot animation runs; every state is still readable |
| W7 | A push to `main` that changes the website or a public entry | CI runs | the site builds as static files and publishes at the GitHub Pages root without deleting PR previews |
| W8 | A 390 px wide screen | any page | nothing overflows horizontally; the code demo scrolls inside its own box |
| W9 | An open PR changing website inputs, including one from a fork | an approved read-only build succeeds | a trusted workflow publishes its current head at `/agent-kit/pr-preview/pr-<number>/` and creates or updates one preview comment; stale or unrelated artifacts cannot overwrite it |
| W10 | A preview page | a visitor opens or navigates it | links, assets, search and language switching work within its base path; every page has noindex metadata and a slim `Preview of #<number>` banner; production has neither |
| W11 | A PR with a published preview | the PR closes | trusted code removes that preview and updates its comment, preserving production and other PRs; it does not execute PR code |

Sizes shown on the landing page are the `size-limit` budgets from each package's `.size-limit.ts`; the support table
is generated from the shipped provider tables, not written by hand.
