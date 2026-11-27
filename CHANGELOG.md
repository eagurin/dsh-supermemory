# Changelog

All notable changes to this bundle are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.8.0] — 2026-11-28

This release closes the gap between the Supermemory v5 API and what the plugin exposed:
the engine already kept dated, versioned, linked facts, and the bundle was not reading
them. Nothing here weakens the existing contract — new parameters are optional, every
default reproduces 0.7.0 behaviour, and the security invariants (nonce-delimited recall,
`sanitizeUntrusted`, `redactSecrets`, own-namespaces-only writes, two-step destructive
actions, upload policy) are unchanged and still tested.

### Added — full read path

- **`supermemory_search` uses the whole v5 search contract.** New optional parameters:
  `includeRelated` (graph relations), `includeForgotten` (replaced/expired memories),
  `includeDocuments` (source document id, title, date, summary), `threshold`, `rerank`,
  and a typed `filter` accepted as an object or JSON text. `limit` now accepts the API's
  1–100 range instead of 1–20. Results are rendered with a `YYYY-MM-DD` date, a
  `superseded` / `inferred` / `forgotten` marker, the memory id, and up to three
  compact relation lines (`updates v1 (earlier, 2026-10-01): …`).
- **New tool `supermemory_memory_history`** over `GET /ns/{ns}/memories/{id}`:
  `memoryId` (required), `includeVersions` (default true), `relatedLimit` (1–10, default
  3), `includeDocument` (default false). It renders the current text, version, state
  (`latest` / `not the latest version`, `forgotten`, `inferred`, `stable profile fact`),
  created/updated timestamps, the version chain nearest first, `extends`/`derives` links,
  the source document, and an optional bounded excerpt. It is read-only and subject to
  the same readable-namespace policy as every other read. The tool list is now eleven.
- **Recall can carry evolution and admits its own failures.** `recallIncludeRelated`
  (default false) puts one relation line per fact into the recall block;
  `recallRerank` (default `inherit`, follows `rerank`) separates recall ranking from tool
  ranking; and `recallFailureNotice` (default true) inserts an explicit
  `memory recall unavailable (timeout) — proceed without memory` (or
  `memory recall incomplete (…) — some namespaces were not searched`) line, so a lost
  recall is visible instead of looking like a short profile. Failure reasons are
  classified (`timeout` / `unreachable` / `not configured` / `error`), never echoed from
  server text.
- **Recall facts carry dates and state**, and the block budget is now split: the profile
  is capped by `profileMaxChars` shared across namespaces and may not take more than half
  the block, so a long profile can no longer crowd out the answer to the actual question.

### Added — write path

- **Captures are dated by the session, not by the write.** The plugin records the
  session-start event time and each user message's event time, and sends `date` as the
  session start for a single document or the earliest turn of each part. When no
  timestamp was observed, `date` is omitted rather than invented.
- **Captures and saves carry a context `group`** (`{project: <workspace base name>,
  kind: "conversation" | "file"}`) and metadata `project` / `kind` in addition to the
  existing keys, so later searches and list calls can filter on them. The full workspace
  path keeps its existing `workspace` metadata key; the group never contains a path.
- **`taskType: "memory"` is explicit** on capture, save, and upload, and
  **`dreaming` now means the same thing on `POST` and `PATCH`.** New `captureDreaming`
  (default `inherit`, follows `dreaming`, so 0.7.0 configurations behave identically)
  separates the processing mode of automatic capture from explicit saves; `dynamic`
  groups related documents for better context at the cost of latency (measured ~9
  minutes on the reference self-hosted stack, where `instant` is immediate and bills one
  extra operation per document). New `captureContext` (default empty) sends a bounded
  `supportingContext` with captures.
- **`supermemory_save` accepts `date` and `group`** and validates them before any network
  I/O; `supermemory_upload_file` sends `taskType`, `date`, and a file group as form
  fields.

### Added — profile, list, namespaces

- **`supermemory_profile` accepts `buckets` and a metadata `filter`**, and its facts are
  now passed through `sanitizeUntrusted` (a profile fact could previously inject a
  heading or the legacy context tag into a tool result).
- **`supermemory_list` covers the whole listing contract**: `chunks` in addition to
  documents and memories, `sort` (`createdAt` / `updatedAt` / `position`), `order`,
  `filter`, `includeForgotten`, and a 1–100 page size.
- **`supermemory_namespaces` and `supermemory_namespace action:list` accept `page` /
  `limit`** and report the total; new **`supermemory_namespace action:show`** reads a
  readable namespace's `supportingContext` without writing.

### Security

- New model-visible surfaces (relations, related ids, document summaries, history text,
  document excerpts, list metadata, namespace context) go through `sanitizeUntrusted` and
  fixed-length bounds; relation names are allowlisted (`updates` / `extends` / `derives`,
  anything else rendered as `related`).
- Recall notices and history excerpt failures are classified, not relayed: server error
  text can no longer reach the model through those paths.
- Filter and group validation keeps rejecting bad shapes before any request and now never
  echoes the rejected field, operator, key, or JSON input (the JSON parser's own message
  could quote the input, so it is no longer included).
- **Server error bodies are redacted and neutralized** before they become a tool error:
  credential shapes are replaced, the text is reduced to one line, and arbitrary `details`
  are dropped (300-character cap). A hostile endpoint can still write instruction text into
  an error — tool errors stay untrusted — but it cannot make the plugin echo the key shape.
- **`supermemory_read_document` sanitizes its header and frames the document body** in its
  own nonce-delimited region with a warning line; the body stays exact for quotations.
- **Capture only retires documents it can prove it wrote.** Before deleting a legacy single
  document of a session, the plugin re-reads it and requires this plugin's `session_id` and
  agent metadata, so a note saved under a colliding id is never removed.
- **The sanitizer treats a bare carriage return as a line break** (Markdown does) and its
  heading pass no longer backtracks across newlines: CR-injected headings are neutralized
  and hostile newline runs stay linear.
- **Capture bookkeeping only evicts idle session state** and clears the timer handle when it
  fires, so eviction cannot leave live timers behind an untracked session; namespace
  inventory listings are clamped with an explicit truncation marker.
- **The opt-in live suite refuses a pre-existing namespace**: it checks that
  `dsh-audit-<YYYYMMDD-HHMM>` did not exist before writing, records whether this run created
  it, and only then deletes it.

### Documentation

- New [docs/API-COVERAGE.md](docs/API-COVERAGE.md): all 16 paths of the local v5
  OpenAPI and every significant search/document/profile/list/namespace parameter are
  mapped to a tool or a deliberate omission with a reason, plus the test that covers it.
  It also records where the official docs and the local OpenAPI differ.
- Both READMEs document the new defaults, the new tool, example questions ("what did I
  decide about X", "how did my position change", "which decisions were made and when"),
  the optional starter buckets, the live-suite command, and the `dreaming` trade-off
  honestly.

### Compatibility

- All new tool parameters are optional and every new setting defaults to the 0.7.0
  behaviour (`recallRerank` and `captureDreaming` inherit the settings that used to drive
  those paths). Configuration keys were not renamed or removed; unknown keys still fail
  loudly. No new dependencies were added (runtime remains `node:` builtins plus
  `@deepseek-ai/schemastery`).
- The release tag and any push are the operator's action and are not part of this change.

### Tests

- 101 → 158 cases: new `test/search.test.mjs`, `test/history.test.mjs`,
  `test/recall.test.mjs`, `test/write-path.test.mjs`,
  `test/profile-list-namespace.test.mjs`, plus an opt-in `test/live.test.mjs` that writes
  only into a `dsh-audit-<YYYYMMDD-HHMM>` namespace, reads real memories from `dsh` to
  exercise the history tool, and deletes the temporary namespace afterwards. The live
  cases skip unless that namespace and a key are supplied explicitly.
- Live verification on the reference self-hosted server (0.0.9): a dated, grouped
  document was written, `date` was stored as `metadata.temporalContext.documentDate`,
  metadata and group reached the server, `include.related` / `include.documents` /
  `include.forgotten` responses were accepted and rendered with dates, metadata filters
  matched documents (54 total vs 36 for `type: conversation`), profile buckets and a
  filtered profile were read, and `supermemory_memory_history` returned a real version-2
  memory with two `updates` parents and a source-document excerpt. During the audit the
  server's own extraction phase was unavailable (its log said the `gpt-6-luna` credential
  pool was cooling down), so freshly written documents produced chunks but no new
  memories or version chains; that part of the live path remains to be observed on a
  server with a working extraction model, and the live suite reports it explicitly.

## [0.7.0] — 2026-11-25

### Changed

- **Timeouts are sized for a busy local server.** `timeoutMs` default 8000 → 120000
  (ceiling 120000 → 300000) and `recallTimeoutMs` default 2500 → 10000 (ceiling 30000 →
  60000). On this machine `hermes_default` holds 11 682 memories, and while the server
  worked through an embedding backlog a single search needed more than 8 s (measured
  outlier: 28.5 s). `supermemory_search` then failed the whole call with
  `Supermemory request to http://127.0.0.1:6767 timed out after 8000 ms` and threw away
  every result — ten such failures in two sessions, plus seven audit probes that hit the
  same ceiling. Waiting for the answer is better
  than losing the request: a slow search now returns its facts, while a genuinely dead
  server still fails at once (`ECONNREFUSED` is reported as unreachable, not as a
  timeout). No timeout was removed, only widened, so a hung server cannot stall a tool
  forever.

### Tests

101 cases, unchanged; the defaults and both ceilings are now pinned by assertions.

## [0.6.1] — 2026-11-25

### Fixed

- **A failed namespace discovery crashed every tool that resolves a container.** The
  resolver was moved to accept a logger, but its `log` call referenced a binding that
  lives inside `apply`, so a discovery error (a busy server, a timeout) threw
  `ReferenceError: log is not defined` instead of degrading to the configured
  containers. The logger is now injected and optional, and a regression test covers a
  failing discovery.

### Tests

100 → 101 cases.

## [0.6.0] — 2026-11-25

Five independent live audits (real server, real hooks, clean-room install, edge-case
fuzzing, documentation) found the defects below. This release fixes them; it is the
first version I would hand to a stranger without caveats.

### Fixed — memory integrity

- **An over-long single turn no longer produces an empty document.** `clampLines` dropped
  the only line when it did not fit, so a 200 KB turn yielded a header-only document — and
  the capture then retired the previous good one. A chunk now keeps its beginning and
  marks what it dropped.
- **A compaction checkpoint without an id no longer re-uses the original document
  family** (which would overwrite the pre-compaction document). The family identity falls
  back to `source.compactionId`, the summary text, then the ordinal, so two id-less
  checkpoints with identical text also land in different families.
- **Two session ids that sanitize to the same string no longer share a document**
  (`a/b` vs `a b`, or a 300-char id): such ids get a short hash suffix, while ordinary
  UUID sessions keep their ids.
- **`deriveMessages()` returning a non-array no longer loses the capture** with a raw
  `TypeError`; the flush is also guarded against running after plugin disposal.

### Fixed — live behaviour

- **Recall honours one deadline.** `recallTimeoutMs` was applied per request (discovery
  + profile + search), so a cold server stalled the first turn for ~9 s and then lost the
  recall. Discovery, profiles and searches now share the remaining budget.
- **A long fact is truncated instead of dropped**, so a 998-char fact no longer leaves an
  empty section when the block budget is small.
- **Namespace discovery failures are no longer cached** for 60 s (which silently removed
  whole namespaces from search and recall) and are logged.
- **Network failures say where they failed** (`cannot reach Supermemory at <baseUrl>:
  ECONNREFUSED`) instead of a bare `fetch failed`.
- **`timeoutMs` is honoured** by the namespace tools, search discovery and uploads instead
  of the hard-coded 4 s/6 s/60 s budgets.
- **Argument validation happens before network I/O**: an invalid filter, list type or
  upload policy no longer costs a discovery request.
- **Search reports a memory id only for real memories**, not for hybrid-mode chunk rows
  that `supermemory_forget` cannot delete.
- **Unknown tool actions are reported as unknown** instead of a misleading argument error.
- **Bucket deletion now requires `confirm: "delete"`**, like the other destructive actions.
- **The default `baseUrl` is `127.0.0.1:6767`**, which is where current
  `npx supermemory local start` listens; `8787` (older releases) is still probed by the
  setup script.

### Fixed — documentation

The audit verified every claim against the code and found several wrong ones, all
corrected: the GUI control is **Plugins → Add plugin** (there is no "Install from URL");
the local server's default port is 6767; `- id:` is an override that DSH *warns* about on
a fresh profile rather than rejecting; the credential store needs `chmod 600`; the
sanitizer strips the legacy tag and heading markers, not arbitrary closing tags;
`forget` by memory id has no preview; bucket deletion is immediate (now confirmed);
`ARCHITECTURE.md` no longer claims that `allowWritesToReadContainers` can open Hermes, that
the plugin never changes server state, that a shrinking session deletes parts, that
`dryRun` is a tool parameter, or that recall carries document ids. Both READMEs now say
where the `scripts/…` commands run (a checkout), that the dependency is required, and that
a Finder-launched app does not inherit shell exports.

### Verified live

- Real root sessions: recall is injected **after** the user request with a per-turn
  nonce, and the request reaches the model (a scheduler-opened session answered normally);
  both probe sessions were captured with `status: done`.
- Compaction on a real server: a new document family appears, no DELETE is issued, and all
  pre-compaction parts still exist afterwards.
- Shrink safety: a truncated surface issues no DELETE and keeps every part.
- Retry policy: a 401 is attempted once; a 500 retries up to `captureRetries`.
- Profile failure: `/profile` returning 500 still yields a decision and an injected block.
- Uploads: outside-root, symlink and hard-link paths refused; a real file reaches `done`.
- 100 unit tests; `check.mjs`; `node --check`.

## [0.5.4] — 2026-11-25

### Fixed

- **Recall now serves turns opened by the scheduler or another agent.** The query was
  taken only from a message whose source kind was `user`, so a session started by a
  scheduled task (source kind `schedule`) got capture but no recall. Any turn source
  counts now (`user`, `schedule`, `team-message`, `parent`); the plugin's own injected
  block still never counts as a request.

### Verified live

- A real root session created by a scheduled task was captured end to end: the document
  `dsh-session-a71725ad-…` appeared with `turns: 1`, `type: conversation`,
  `status: done`, and the scheduled message is part of its content.
- The compaction family path was observed on a real session
  (`dsh-session-6df2638e-…-c74a9e650`), which is what protects pre-compaction turns.

## [0.5.3] — 2026-11-25

Fixes a real-world failure: on a brand-new session the agent received only the recall
block and asked the user what to do, although the task was in the chat.

### Fixed

- **The recall block no longer precedes the user's request.** A turn therefore sent
  two consecutive user messages — the recall block, then the question — and a gateway
  that collapses consecutive user turns kept only the first, so the question never
  reached the model. The block is now inserted *after* the human message; the
  request survives any collapse order, and a gateway that concatenates still gets the
  question before the background. The block header now says where the request is.
- The session log of the reported case confirmed the shape: the recall message was
  committed before the human message, and the model's reasoning explicitly said it saw
  only the recall block.

### Tests

92 cases; the recall test is now an ordering invariant — the human message must stay
the first user message of the turn, with the block directly after it.

## [0.5.2] — 2026-11-25

Documentation-only release: the install instructions named a command that does not
exist on a Desktop install.

### Fixed

- **The README's primary install path was wrong for DSH Desktop.** A Desktop
  installation ships only the application, so `dsh plugin …` is not on `PATH`; the
  documented command failed before any plugin work started. The three paths that
  actually exist are now documented in order: ask the agent
  (`plugin_manager install_bundle` with the git spec), the GUI (*Plugins → Add plugin*), and the npm CLI (`npx @deepseek-ai/dsh plugin …`) only for
  people who have it. The same correction is in the Russian mirror, in
  `scripts/setup.mjs` next steps, and in `AGENTS.md`.
- The row-by-hand section now states that `- id: supermemory` is an override and
  needs `insert` on a fresh profile, with the exact error DSH returns.

## [0.5.1] — 2026-11-25

Follow-up review of the v0.5.0 patch itself. One release blocker and several real
defects; behaviour that 0.5.0 claimed but could not deliver is now described
honestly instead.

### Fixed

- **Every session's first turn could fail.** The profile-fetch error path referenced
  an out-of-scope `options`, so a failing `/profile` call (missing key, slow or
  unreachable server, fresh namespace) threw `ReferenceError` inside
  `agent/pre-step` and ended the turn with an error instead of degrading. The
  failure list is now passed explicitly and a failing profile is just a warning.
- **The recall block lost its closing marker when truncated**, leaving the human
  question inside an unterminated "untrusted" region. The body is clamped and the
  nonce closer is appended afterwards.
- **Refused deletions were treated as success.** The document endpoint can refuse a
  document that is still processing; the plugin dropped such ids from its state and
  never retried, leaving duplicate documents. Only confirmed deletions are
  forgotten now, the rest retry on the next flush.
- **A checkpoint without an id re-created the original data loss** by falling back
  to the first document family and deleting the parts that held earlier turns. The
  identity now comes from `id`, then `source.compactionId`, then the text, and a
  checkpoint never maps to the original family.
- **A surface that shrinks for another reason (rewind, rewrite) deleted documents**
  holding turns that existed nowhere else. A shrink no longer retires anything.
- `container` may no longer name a Hermes namespace (it was the last write path that
  bypassed the guard); the capture loop cannot produce an unhandled rejection;
  dead per-session state was removed.
- `defineTool` enforces required arguments for definitions that already pass a JSON
  Schema; `search` reports memory ids (`v5` returns no document ids); forget's
  description no longer mentions the removed `dryRun` flag and describes the
  server's soft delete correctly; `scripts/setup.mjs` derives the install tag from
  `package.json`, and `check.mjs` fails if it is hardcoded again.

### Changed

- Chunked documents no longer include the total part count in their header, so
  adding a part does not invalidate every earlier part's content hash.

### Corrected documentation

- 0.5.0 claimed that earlier recall blocks are pruned from the transcript. They
  cannot be removed from that hook, so the code no longer pretends to: the block
  stays, bounded by `recallMaxChars` and `maxRecallResults`.

### Tests

83 → 92 cases: profile-failure degradation, truncated-closer containment, refused
deletion retry, id-less checkpoint family, shrink safety, forget by id (success and
refusal), the `matches` response shape, the confirm gate on a writable namespace,
and `readVerifiedFile` (hard link, symlink, size cap).

## [0.5.0] — 2026-11-25

Security and conformance release from four independent reviews (code, security, DSH
plugin contract, stranger install). Several fixes are breaking; every one is listed
below.

### Security

- **Recall can no longer forge its own block.** The block is delimited by a fresh
  random nonce per turn instead of a fixed tag, and recalled facts and profile text
  pass through `sanitizeUntrusted`, which removes control characters,
  `</supermemory-context>` tokens and heading markers. Previously a document could
  close the block and issue instructions as first-party user content.
- **`supermemory_namespace action=context` was a cross-agent write hole.** It
  PATCHed any namespace, including Hermes ones, bypassing the write policy. It now
  goes through `resolveWriteContainer` and refuses another agent's namespace.
- **Namespace deletion is an allowlist, not a denylist**, and `moveTo` is removed:
  only a namespace this agent may write can be deleted, never its own.
- **Uploads resist hard links and TOCTOU.** `realpathSync` cannot see a hard link,
  so a link inside an allowed root used to reach any file on the volume; files with
  more than one link are refused, the file is opened with `O_NOFOLLOW`, and read
  through that descriptor with a byte cap.
- **`supermemory_forget` is two-step**: it previews and deletes only with
  `confirm: "delete"`. `dryRun` used to default to destructive.
- **Captures are redacted** (`redactSecrets`, on by default): credential shapes are
  replaced with `[redacted]` before a transcript reaches the server.
- `writeContainers` refuses a Hermes name at config time, and
  `allowWritesToReadContainers` no longer reaches `hermes*`.
- HTTP redirects are refused (`redirect: 'error'`), a `baseUrl` with embedded
  credentials is rejected, and a `moveTo`-style coerced name can no longer redirect
  a write into `dsh`.
- `check.mjs` now scans every text file in the package for secrets, including the
  `sm_…` format this server actually uses, and fails on documentation drift.

### Changed (breaking)

- **Cross-agent reads are opt-in**: `readContainers` and `readPrefixes` default to
  `[]`, and the shipped patch no longer enables Hermes reads. Add the override in
  the README to recall another agent's memory.
- The recall block markers are now `<<<supermemory-<nonce>>>` /
  `<<<end-supermemory-<nonce>>>`; anything matching the old tag is not a delimiter.
- `supermemory_namespace` no longer accepts `moveTo`, and deleting requires
  `confirm`.
- Tool definitions are converted to object-rooted JSON Schema at registration and
  declared required arguments are validated before `execute`; previously the model
  received a bare parameter map and nothing was validated.

### Documentation and packaging

- **English README.md** is the primary document, with a Russian mirror
  (README.ru.md); both now show the canonical install path (`dsh plugin add`), the
  credentials YAML shape, the real local-server commands (`npx supermemory local
  install` then `start`), and the correct `engines.dsh` version.
- The Plugin Manager detail page now follows the contract: `docs/DETAIL.md` is a
  single feature image (`docs/preview.svg`), while the long document moved to
  `docs/ARCHITECTURE.md`.
- `meta.description` explains usage and limitations instead of one sentence.
- `scripts/setup.mjs` prints the plan again on the human path (it referenced an
  undefined variable, so every non-JSON invocation crashed) and is covered by tests.

### Correctness and data integrity (from the code review)

- **A compaction no longer destroys captured memory.** DSH represents compaction as a
  `compact-checkpoint` user message that replaces the earlier messages on the
  surface; the old transcript builder dropped it, so a post-compaction capture wrote
  an assistant-only `turns: 0` document and deleted the parts that held the earlier
  turns. The checkpoint is now kept as a labelled summary and switches the document
  family (`…-c<hash>`), so older documents are never overwritten or deleted;
  assistant-only traces are not captured at all.
- **Capture content is stable**, so an unchanged turn no longer rewrites every
  document (the header embedded a fresh timestamp into the hash, making each build
  differ and re-trigger server processing).
- **Overlapping captures are serialized per session**, which removes a race where an
  older plan deleted the parts a newer plan had just written.
- **Scheduled and team messages are captured as turns** (`schedule`,
  `team-message`, `parent`), not silently skipped.
- Permanent 4xx errors are no longer retried forever; only network, 408, 429 and 5xx
  responses retry, and a 4xx logs a warning once.
- Session state is released on `session/disposed`, so full session logs are not
  pinned in memory for weeks.

### Fixed (API and tools)

- `supermemory_forget` reads the real response (`matches`, `count`, `errors`), so it
  reports what happened; deleting by id now fails loudly when the server removed
  nothing.
- Ingest statuses (`extracting`, `chunking`, `embedding`, `indexing`) are reported
  instead of "unknown", and a 404 right after a save keeps polling instead of
  giving up.
- API errors keep their structure (`details`, object `error`) instead of printing
  `[object Object]`.
- `supermemory_namespace` requires an explicit namespace and an explicit `context`
  (a missing `context` used to clear the namespace), and deletion only covers the
  writable allowlist.
- `supermemory_buckets` recognises the agent's own namespace when it is passed
  explicitly; writable namespaces are readable too; the filter validator enforces
  the server's per-operator rules; profile buckets are included in profile facts;
  uploads send `dreaming`.

### Packaging

- The default `baseUrl` matches the local server's own default (`127.0.0.1:8787`),
  and the setup script probes both `8787` and `6767` before asking.
- `captureRetryDelayMs` is configurable (tests and operators need a short delay).

### Tests

51 → 83 cases: nonce block and sanitization, redaction, JSON Schema conversion and
required-argument validation, write-policy refusals, upload guards (symlink, hard
link, size, disabled), two-step forget, strict list type, compaction family
behaviour, stable hashing, overlapping captures, scheduled turns, 4xx retry policy,
and CLI-level setup runs.

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
