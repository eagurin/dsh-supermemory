# Changelog

All notable changes to this bundle are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-11-25

Config schema, metadata filters, ingest status, and unit tests. Behaviour with the
previous configuration is unchanged: every new option defaults to the old
behaviour.

### Added

- **Config schema** (`export const Config`, `@deepseek-ai/schemastery`). The
  Settings page gets typed fields, the Loader validates the row, and a wrong
  enum or type is rejected at activation. An unknown key is no longer ignored:
  `threshod: 0.5` now fails with the list of allowed keys instead of silently
  keeping the default.
- **Metadata filters.** `filter` in the config applies to recall in this agent's
  own namespace; `supermemory_search` takes a per-call `filter` that applies to
  every namespace it searches. Both accept a JSON object or a predicate tree
  (`and` / `or`, up to five levels). Measured on the live server: the same query
  returned five conversation fragments without the filter and notes with facts
  with `{"field":"type","operator":"neq","value":"conversation"}`.
- **`rewriteQuery`** (config and per call): the server rewrites the query before
  searching. Off by default — it adds about 2.7 s to a search.
- **Ingest status.** `supermemory_save` now waits up to `ingestWaitMs` (1.5 s by
  default) and reports `queued` / `processing` / `done` / `failed`;
  `supermemory_read_document` and `supermemory_list` show the stored status too.
- **Unit tests** (`node --test test/`, 32 cases) over the pure helpers — settings
  normalization, filter validation, container naming, text budgets, and transcript
  capture — plus a schema test that validates the configuration used on this
  machine. CI runs them.

### Fixed

- `clampLines` returned an empty string when the budget was smaller than the
  truncation marker.
- `sanitizeContainer` rewrote `-` to `_`, so a namespace legitimately named
  `my-agent` silently resolved to a different name; the API allows hyphens and
  they now survive.

### Notes

- The package now depends on `@deepseek-ai/schemastery@3.19.0`. A git install
  resolves it automatically; a plain directory `link:` has no dependency tree, so
  the schema is skipped there and the runtime validation alone applies.

## [0.1.0] — 2026-11-25

First release: Supermemory v5 long-term memory for DeepSeek Harness, sharing the
server that already holds the Hermes agent's memory.

### Added

- **Automatic recall.** Before the first step of a turn the last user question is
  searched across the agent's own namespace and the read-only containers, and the
  matching facts are injected as a `<supermemory-context>` message that says
  explicitly it is background, not instructions.
- **Automatic capture.** A finished turn rewrites the whole session as one
  document `dsh-<sessionId>`, so edits, compaction, and repeated turns update the
  same document instead of piling up copies.
- **Memory split by agent.** Writes go to the agent's own namespace (`dsh` by
  default); `hermes_default` and every `hermes*` namespace are read-only, and each
  recalled fact is labelled with the container and the agent it came from.
- **Seven tools**: `supermemory_search`, `supermemory_profile`,
  `supermemory_save`, `supermemory_forget`, `supermemory_read_document`,
  `supermemory_list`, `supermemory_namespaces`.
- **System prompt section** that tells the model where its memory lives and that
  another agent's facts are not its own actions.
- **No dependencies** beyond `node:` builtins; the API key is resolved per
  operation through the Host credentials service (`SUPERMEMORY_API_KEY`).

### Notes

- `package.json` keeps the development name `@local/dsh-supermemory` so the live
  profile keeps working; the release is installed from a git tag.
- The README table documents every configurable default, and
  `node scripts/check.mjs` fails when the code and the table drift apart.
