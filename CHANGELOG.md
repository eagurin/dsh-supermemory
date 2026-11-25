# Changelog

All notable changes to this bundle are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-11-25

The remaining server capabilities: long sessions no longer lose their beginning,
files can enter memory, and namespaces and profile buckets are manageable.

### Added

- **Chunked capture.** A session that does not fit `maxCaptureChars` is split on
  turn boundaries into `dsh-<sessionId>-p1…pN` (`captureTurnsPerChunk`, 25 turns
  by default). Previously the transcript was tail-clamped, so the beginning of a
  long session was silently dropped. Crossing the limit deletes the earlier single
  document and shrinking back deletes the leftover parts, so facts are neither
  duplicated nor orphaned.
- **`supermemory_upload_file`** — PDF, images, text and office documents through
  `/document/file`, with the processing status. Off by default (`allowFileUpload:
  false`) and confined to `uploadRoots`: the path is canonicalized with
  `realpathSync` and anything outside the listed directories is refused, so an
  injected instruction cannot exfiltrate `~/.ssh/id_rsa` through the memory server.
- **`supermemory_namespace`** — list namespaces, set or clear `supportingContext`,
  delete a namespace (optionally with `moveTo`). Deletion needs `confirm: delete`
  and refuses the agent's own namespace and any Hermes namespace. The server has
  no `POST /ns`: namespaces cannot be created through this API.
- **`supermemory_buckets`** — list, set and delete profile buckets, so facts can be
  classified into named groups instead of one flat profile.

### Verified

Every new endpoint was exercised against the live local server before the
release: bucket set/list/delete, a real file upload (`status: queued` → `done`),
and document deletion (`count: 1`). 51 unit tests pass.

## [0.3.0] — 2026-11-25

Server choice at install time, plus the hardening pass from the public-repository
security review.

### Added

- **`scripts/setup.mjs` — asks where the memory should live.** It probes the local
  server (`/v3/health`, three attempts, because the server restarts on its own
  schedule), asks `local` or `cloud`, and prints the complete Loader row. With no
  local server it does **not** quietly fall back to the cloud: interactive mode
  asks, `--json` returns `needDecision` with both options and exit code 3. Without
  a terminal it refuses prompts and demands `--mode`, instead of exiting silently
  with an empty promise.
- `buildPlan()` and `reachable()` are exported and unit-tested, so the decision
  logic is covered without a terminal or a server.
- `SECURITY.md`: what the bundle promises (no secrets, per-request key resolution,
  read-only Hermes namespaces, no install scripts, no telemetry) and what it does
  not (transcripts leave the machine when the cloud server is chosen).

### Changed

- The setup flow is documented as step one of installation: local or cloud is an
  operator decision with different consequences, not a default to assume.
- `AGENTS.md` now requires asking that question before an install.
- Machine-specific path in a test fixture replaced with a neutral one, so the
  public repository carries no local paths.

### Tests

44 cases: the previous 32 plus write-isolation (`hermes*` stays read-only unless
`allowWritesToReadContainers` is on) and setup-plan coverage. `check.mjs` also
fails the build when a `/ns/` path is interpolated without `encodeURIComponent`.

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
