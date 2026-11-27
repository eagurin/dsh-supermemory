# Supermemory API v5 coverage

What this bundle uses of the Supermemory v5 namespace API, what it deliberately does
not use, and where each item is tested. The point of the matrix is to answer "does the
plugin use the API's real potential" without claiming features the API does not have.

## Authority order

1. **The local server's `openapi.json`** — the contract this bundle is written against.
   On the reference machine: `GET http://127.0.0.1:6767/openapi.json` reports
   `openapi: 3.1.0`, `info.version: 5.0.0`, **16 paths** (`supermemory-server 0.0.9`).
2. **Official documentation** (`supermemory.ai/docs`, `.../docs/llms.txt`) — semantics
   the schema does not spell out (what `updates`/`extends`/`derives` mean, `dreaming`,
   statuses, self-hosted limits).
3. **Reference-SDK snippets** — only as examples; never as a source of field names.

Reproduce the path list:

```bash
curl -s http://127.0.0.1:6767/openapi.json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.info.version);for(const [p,o] of Object.entries(j.paths))console.log(p,Object.keys(o).join(","))})'
```

### Documented differences worth knowing

| Observation | Handling |
|---|---|
| The official docs also describe `/v3/...` routes and connectors/MCP; the self-hosted `openapi.json` has neither. | Only routes present in the local OpenAPI are used. Connectors and the hosted MCP server are platform features and are **not** exposed by this plugin. |
| `POST /ns/{ns}/memories` does not exist in the v5 OpenAPI; `/ns/{ns}/memories` is `DELETE` only, and searching memories is `POST /ns/{ns}/search` with `searchMode: "memories"`. | The plugin never calls a nonexistent route; memory search goes through `/search`. |
| The extraction model and embeddings of a self-hosted server are the operator's own (here: an OpenAI-compatible gateway). | Extraction quality and latency are server-side; the plugin surfaces status and dates instead of guessing. |
| On the reference server, `PUT/PATCH` document writes accept the same processing fields as `POST` (`taskType`, `dreaming`, `group`, `date`, `supportingContext`). | Both verbs send the same fields, so updating a document cannot silently change its processing mode. |
| `system.createdAt`/`updatedAt` come back in both `2026-11-25T12:13:28.677Z` and `2026-11-25 16:57:16.784` shapes depending on the endpoint. | Dates are validated and rendered as `YYYY-MM-DD` (plus `HH:MM` for memory history); an unparseable value is omitted, never echoed. |

## Paths (16/16 accounted for)

Legend: **used** — reachable from a tool or a hook; **partial** — reachable with a
deliberate argument or field omission; **not used** — explained, with the reason.

| # | Path | Operations | Plugin surface | Status | Test |
|---|---|---|---|---|---|
| 1 | `/ns/{ns}/document` | `POST`, `DELETE` | `supermemory_save`; auto-capture; document retirement | used | `write-path`, `integration`, `regressions` |
| 2 | `/ns/{ns}/document/batch` | `POST` | — | **not used**: bulk ingestion of up to 600 arbitrary documents is a knowledge-base import, not agent memory; capture writes one upserted document per session part, and a partial-failure batch would be harder to reconcile than the per-document writes already used. | — |
| 3 | `/ns/{ns}/document/{id}` | `GET`, `PATCH` | `supermemory_read_document`; capture status polling; upsert `PATCH` | used | `read-path`/`history`/`integration` |
| 4 | `/ns/{ns}/document/file` | `POST` | `supermemory_upload_file` | used | `security` (upload policy), `integration` |
| 5 | `/ns/{ns}/document/file/{id}` | `POST`, `PATCH` | — | **not used**: replacing a file in place would rewrite the source document's content while keeping its id, destroying the very history this release makes readable; no tool needs it. | — |
| 6 | `/ns/{ns}/search` | `POST` | `supermemory_search`; auto-recall; `supermemory_profile` (query matches) | used | `search`, `recall`, `security` |
| 7 | `/ns/{ns}/profile` | `POST` | `supermemory_profile`; auto-recall profile section | used | `profile-list-namespace`, `recall` |
| 8 | `/ns/{ns}/profile/buckets` | `GET`, `PUT`, `DELETE` | `supermemory_buckets` | used | `security`, `profile-list-namespace` |
| 9 | `/ns/{ns}/memories` | `DELETE` | `supermemory_forget` by id | used | `security` |
| 10 | `/ns/{ns}/memories/semantic` | `DELETE` | `supermemory_forget` by description (preview, then `confirm: "delete"`) | used | `security` |
| 11 | `/ns/{ns}/list/{type}` | `POST` | `supermemory_list` (`documents`, `chunks`, `memories`) | used | `profile-list-namespace` |
| 12 | `/ns/{ns}/memories/{id}` | `GET` | `supermemory_memory_history` (new in 0.8.0) | used | `history`, `live` |
| 13 | `/ns` | `GET` | `supermemory_namespaces`, `supermemory_namespace action:list`; readable-namespace discovery | used | `profile-list-namespace`, `regressions` |
| 14 | `/namespaces` | `GET` | — | **partial**: documented alias of `/ns` with the same payload; the plugin calls `/ns` (the route the docs use for discovery) and never needs both. | `profile-list-namespace` |
| 15 | `/ns/{ns}` | `GET`, `PATCH`, `DELETE` | `supermemory_namespace` actions `show`, `context`, `delete` | used (`moveTo` deliberately omitted) | `security`, `profile-list-namespace` |
| 16 | `/organization` | `GET`, `PATCH` | — | **not used by design**: organization-wide context steers memory formation in *every* namespace, including another agent's. Writing it from an agent plugin would silently change how Hermes' memory is extracted; the plugin's contract is per-namespace. | — |

So: 13 of 16 paths are reachable, 1 is covered by an equivalent route, and 2 are
deliberately out of scope for stated reasons. `document/batch`, `document/file/{id}`
and `organization` are the only paths with no plugin surface.

## Search: every documented parameter

`POST /ns/{ns}/search` request fields, and the tool/hook surface for each.

| Field | Type / range | Plugin surface | Notes |
|---|---|---|---|
| `query` | string, ≥1 | `supermemory_search.query`; recall uses the latest user turn | Required everywhere. |
| `filter` | `FilterExpression`, ≤5 nesting levels | `supermemory_search.filter`, `supermemory_profile.filter`, `supermemory_list.filter`, config `filter` (recall) | Accepted as an object or JSON text, validated locally (`normalizeFilter`): operator allowlist, per-operator value type, `caseSensitive` only for text operators, ≤200 operands, ≤5 levels. Errors never echo values. |
| `searchMode` | `hybrid`, `memories`, `chunks` | `supermemory_search.mode`, config `searchMode` | Default `hybrid`. |
| `limit` | 1–100 | `supermemory_search.limit` | Tool clamps to 1–100; recall uses `ceil(maxRecallResults / namespaces)`. |
| `include.documents` | boolean | `supermemory_search.includeDocuments` | Renders document id, title, date, and summary; exact text is one `supermemory_read_document` call away. |
| `include.related` | boolean | `supermemory_search.includeRelated`, config `recallIncludeRelated` | Renders at most 3 relations per fact (`updates`/`extends`/`derives`, direction, version, date); recall shows one relation per fact to stay inside its budget. |
| `include.forgotten` | boolean | `supermemory_search.includeForgotten`, `supermemory_list.includeForgotten` | Forgotten rows are rendered with a `forgotten` marker. |
| `threshold` | 0–1 | `supermemory_search.threshold`, config `threshold` | Default from config (0.3). |
| `rerank` | `none`, `order`, `aggregate` | `supermemory_search.rerank`, config `rerank` / `recallRerank` | Default `none`; recall has its own setting that inherits `rerank` unless set. |
| `rewriteQuery` | boolean | `supermemory_search.rewriteQuery`, config `rewriteQuery` | Description states the ~400 ms cost; recall uses the config value. |
| response `isLatest`, `isInference`, `isForgotten`, `version`, `system.createdAt/updatedAt` | — | search rendering, memory history | Rendered as `superseded` / `inferred` / `forgotten` markers and a `YYYY-MM-DD` date. |
| response `included.related.parents/children/siblings` | — | search rendering, memory history, recall | Flattened and bounded (`normalizeRelations`); relation names are allowlisted, text and ids are sanitized. |
| response `included.document` | — | search rendering, memory history | Bounded to id/title/type/summary/dates. |

## Writing: every documented field

| Field | Type | Capture (auto) | `supermemory_save` | `supermemory_upload_file` | Notes |
|---|---|---|---|---|---|
| `content` | string | transcript | `content` | file bytes | Redacted (`redactSecrets`) before capture is sent. |
| `id` | string, ≤255 | `dsh-<sessionId>[-pN]` | `documentId` | server-issued | Stable identity is what makes version chains possible. |
| `supportingContext` | string ≤1500 | config `captureContext` (empty by default) | `context` | `context` | Extraction guidance; empty means the server decides. |
| `metadata` | flat map | `sm_source`, `source_agent`, `type`, `kind`, `project`, `session_id`, `family`, `workspace`, `turns`, `part/parts/from_turn/to_turn`, `chunked` | `type`, `kind`, `project`, `title` | `type`, `kind`, `project`, `file_name`, `bytes`, `title` | The keys a filter can select on: `type`, `kind`, `project`, `session_id`, `source_agent`. |
| `group` | flat map | `{project, kind}` | `group` argument | `{project, kind: "file"}` | Isolates related context during processing; the project is the workspace directory's base name, never a full path. |
| `date` | ISO 8601 | session start; per part, its earliest turn | `date` argument (defaults to write time) | upload date | Stored by the server as temporal context (`metadata.temporalContext.documentDate`); the plugin omits it when the timestamp is unknown instead of inventing one. |
| `taskType` | `memory`, `superrag` | `memory` | `memory` | `memory` | The bundle always wants memories, never retrieval-only documents. |
| `dreaming` | `dynamic`, `instant` | config `captureDreaming` (inherits `dreaming`, default `instant`) | config `dreaming` | config `dreaming` | `instant` makes facts available right after processing and bills one extra operation per document; `dynamic` groups related documents (better context, facts appear later — measured ~9 minutes on the reference stack). Both `POST` and `PATCH` now send the same value. |

Document write `DELETE` (`ids`, 1–100 per call) backs the capture retirement logic and
is covered by `regressions` (a refused deletion is retried, a shrinking surface never
deletes).

## Reading one memory: every documented parameter

| Field | Type | Plugin surface |
|---|---|---|
| path `id` | string | `supermemory_memory_history.memoryId` |
| `include` `related` / `documents` | enum array | `includeVersions` (default true), `includeDocument` (default false) |
| `relatedLimit` | 1–100 | `relatedLimit` (1–10, default 3) |

Rendered: current text, version, `latest`/`not the latest version`, `forgotten`,
`inferred`, `stable profile fact`, created/updated timestamps, the version chain
(nearest first), `extends`/`derives` links, the source document, and an optional
bounded excerpt fetched from `GET /document/{id}`. Read-only and subject to the same
readable-namespace policy as every other read.

## Profile and buckets

| Field | Plugin surface |
|---|---|
| `profile.filter` | `supermemory_profile.filter` |
| `profile.buckets` | `supermemory_profile.buckets` (slugs validated locally) |
| `GET/PUT/DELETE /profile/buckets` | `supermemory_buckets` (`list`, `set`, `delete` with `confirm: "delete"`) |

Buckets the bundle does not create on its own: a personal namespace may want
`decisions`, `projects` and `constraints` in addition to `preferences`. The bundle
never changes server-side bucket state at setup; the operator (or the agent, with
`supermemory_buckets`) decides. A suggested starter set is documented in the README,
not applied automatically.

## Listing and namespaces

| Field | Plugin surface |
|---|---|
| `list` path `type` | `documents`, `chunks`, `memories` |
| `list` query `page`, `limit` (1–100), `sort` (`createdAt`/`updatedAt`/`position`), `order` (`asc`/`desc`) | `supermemory_list.page/limit/sort/order` |
| `list` body `filter`, `include.forgotten` | `supermemory_list.filter/includeForgotten` |
| `/ns` query `page`, `limit` | `supermemory_namespaces.page/limit`, `supermemory_namespace action:list` |
| `/ns/{ns}` `GET` | `supermemory_namespace action:show` |
| `/ns/{ns}` `PATCH` `supportingContext` | `supermemory_namespace action:context` (writable namespaces only) |
| `/ns/{ns}` `DELETE` (+ `moveTo`) | `supermemory_namespace action:delete`; `moveTo` is deliberately not exposed — moving another namespace's documents into this agent's memory was never a safe operation. Deletion is an allowlist of writable namespaces, never the plugin's own, and requires `confirm: "delete"`. |

## What is not exposed on purpose

- **`/organization`** — account-wide extraction context affects other agents' memories.
- **`document/batch`** — bulk import; not agent memory.
- **`document/file/{id}` (replace file)** — destroys the document history the read path
  now exposes.
- **`GET /document/{id}?include=chunks,memories`** — the same data is reachable through
  `supermemory_search` (`searchMode: chunks` / `memories`) and
  `supermemory_memory_history`; duplicating it on the document tool would add a second
  rendering path with its own truncation rules for no new capability.
- **`fileType` / `mimeType` upload fields** — the plugin sends a typed `Blob` with a
  MIME type derived from the extension, which is what the server uses; an explicit
  override is a low-level fix for inference failures that no tool needs.

## Where the tests live

| Area | File |
|---|---|
| Search parameters, rendering, filter validation, truncation | `test/search.test.mjs` |
| Memory history (versions, links, document excerpt, isolation) | `test/history.test.mjs` |
| Recall hook (notice, relations, profile budget, scheduled turns) | `test/recall.test.mjs` |
| Capture and save write path (date, group, dreaming, metadata) | `test/write-path.test.mjs` |
| Profile, list, namespaces, namespace show | `test/profile-list-namespace.test.mjs` |
| Security invariants, redaction, upload policy | `test/security.test.mjs` |
| Capture chunking and regressions | `test/chunks.test.mjs`, `test/regressions.test.mjs` |
| Real server (opt-in, temporary namespace) | `test/live.test.mjs` |
