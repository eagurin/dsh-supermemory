# Supermemory for DeepSeek Harness

Long-term memory for a [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) agent, backed by a
[Supermemory](https://supermemory.ai) server (v5 API): your own namespace for writing, optional
read-only recall from other agents such as Hermes, automatic recall before a turn, and automatic
capture of the finished session.

- **Own memory.** Everything the agent saves or captures goes to its own namespace (`dsh` by default).
- **Optional cross-agent reads.** Other agents' namespaces can be listed as read-only; each recalled
  fact is labelled with its container, and such content is delivered as untrusted background data.
- **Recall before a turn.** The latest user question is searched before the first step and the
  matching facts are injected in a per-turn, nonce-delimited block.
- **Capture after a turn.** The session is upserted as one document (`dsh-<sessionId>`), or as
  `dsh-<sessionId>-p1…pN` when it exceeds `maxCaptureChars`; parts update in place. Each document
  carries its real date (session start, or the earliest turn of a part) and a context group, so
  "when did I say this" survives a late or resumed write.
- **The full v5 read path.** `supermemory_search` exposes the API's `include.related`,
  `include.documents`, `include.forgotten`, `rerank`, `threshold` and typed `filter`; results carry
  dates and `superseded` / `inferred` / `forgotten` state instead of bare text.
- **Memory history.** `supermemory_memory_history` reads one memory by id with its version chain,
  `extends`/`derives` links, dates, and an optional source-document excerpt — the evolution of a
  position, not just its latest wording.
- **Twelve tools**: search, memory_history, profile, save, save_many, forget, read_document, list,
  namespaces, upload_file, namespace, buckets.
- **A bundled skill.** The bundle registers a `supermemory` skill (like the official Supermemory
  skill) that tells the model when to search, what is worth saving, how to read a memory's history,
  and how to index a project — loaded on demand instead of living in every prompt.
- **Recall that does not repeat itself.** Facts already injected in a session are skipped, the
  profile is refreshed on schedule instead of re-emitted every turn, the search prefers extracted
  memories at a higher relevance floor, and the block says where the facts came from.
- **Honest recall.** A recall that times out says so in the block (`memory recall unavailable
  (timeout) — proceed without memory`) instead of silently returning only the profile, and a failed
  capture is mentioned in the next block.

## Requirements

| Need | Detail |
|---|---|
| DSH | `@deepseek-ai/dsh` `0.2.2-0` or newer (tested on `0.2.2-rc.5`; `engines.dsh: >=0.2.2-0`). |
| A Supermemory server | Either your own local server or Supermemory Cloud. |
| An API key | Stored in the DSH credential store under `SUPERMEMORY_API_KEY`. |
| Node | 22+ recommended for `scripts/setup.mjs` (it uses only standard APIs; 18+ works). |

### Choose a server first

| Option | Start it | Key |
|---|---|---|
| Local (recommended for privacy) | `npx supermemory local install` once, then `npx supermemory local start` (port 6767) | `cat ~/.supermemory/api-key` |
| Cloud | nothing to run | create one in the Supermemory console |

The local server listens on `127.0.0.1:6767` by default (`PORT` or `--port` changes it; older releases
used `8787`). The setup script probes both, so it finds your server either way.

Ask the setup script and it will probe the local server, ask which option you want, and print the
complete configuration row:

```bash
node scripts/setup.mjs                 # interactive; needs a terminal
node scripts/setup.mjs --mode local    # or --mode cloud, no prompts
node scripts/setup.mjs --json          # machine-readable plan (exit 3 + needDecision on stderr if no server and no --mode)
```

It never silently picks the cloud: with no local server it asks (or, in `--json` mode, returns
`needDecision`). With the cloud server, captured transcripts leave your machine.

## Install

A DSH **Desktop** installation has no `dsh` shell command; the plugin is installed
through DSH itself. Pick one:

1. **Ask the agent** (works out of the box): tell it to install the bundle

   ```
   plugin_manager install_bundle → git+https://github.com/eagurin/dsh-supermemory.git#v0.9.0
   ```

2. **GUI**: *Plugins → Add plugin*, then paste
   `git+https://github.com/eagurin/dsh-supermemory.git#v0.9.0` into **Package name or address**.

3. **CLI** (any machine with Node 22+ and network; the `desktop` profile must already exist, the app
   fully quit, and `pnpm` on `PATH`):

   ```bash
   npx @deepseek-ai/dsh plugin --profile desktop add "git+https://github.com/eagurin/dsh-supermemory.git#v0.9.0"
   ```

The bundle inserts its own `cordis.patch.yml`, so no profile row has to be written by
hand. The `scripts/…` commands below run in a checkout of this repository
(`git clone --branch v0.9.0 --depth 1 https://github.com/eagurin/dsh-supermemory.git`); installing
the bundle does not create one. A plain `pnpm add` inside the profile installs the package but does **not**
select it in `dsh.profile.bundles`, so the plugin stays inactive — use one of the
three paths above.

<details>
<summary>Writing the row by hand (advanced)</summary>

`- id: supermemory` is an **override**: it replaces the config of an existing entry
and on a fresh profile is skipped with a warning (`patch: entry "supermemory" not found`;
the profile still boots). To add
the plugin without selecting the bundle, wrap the row in `insert`:

```yaml
- insert:
    - id: supermemory
      name: '@local/dsh-supermemory'
      config:
        baseUrl: http://127.0.0.1:6767
```
</details>

## Configure

The API key never goes into configuration or this repository — only its reference name does. Put the
value into the DSH credential store, which reloads live:

```yaml
# $DSH_HOME/.credentials.yaml  (default: ~/.dsh/.credentials.yaml)
version: 1
refs:
  SUPERMEMORY_API_KEY: <your key>
```

Then `chmod 600 "$DSH_HOME/.credentials.yaml"`: DSH refuses a credential store that other users can
read and reports the key as empty. Exporting `SUPERMEMORY_API_KEY` before launching DSH works as a
fallback, but a Desktop app launched from Finder does not inherit shell exports.

All settings are optional; an override replaces the bundle's `config`, and any key you leave out
falls back to the default below.

| Key | Default | Meaning |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:6767` | Supermemory server (the local default port; older releases used `8787`) or `https://api.supermemory.ai`. |
| `apiKeyRef` | `SUPERMEMORY_API_KEY` | Credential reference holding the key. |
| `container` | `dsh` | This agent's own namespace — the only one written by default. |
| `readContainers` | `[]` | Namespaces this agent may read. **Opt-in**: empty by default. |
| `readPrefixes` | `[]` | Namespace prefixes discovered as readable. **Opt-in**. |
| `writeContainers` | `[]` | Extra namespaces allowed for writing. Hermes namespaces are rejected. |
| `allowWritesToReadContainers` | `false` | Also allow writing to the namespaces listed in `readContainers` (never to Hermes ones). |
| `autoRecall` | `true` | Recall before the first step of a turn. |
| `autoCapture` | `true` | Capture the finished turn. |
| `recallSubagents` | `false` | Give subagents recall too. |
| `captureSubagents` | `false` | Write subagent sessions into memory. |
| `maxRecallResults` | `6` | Facts admitted into one turn. |
| `minQueryChars` | `12` | Shortest question worth a recall search; `/`, `!` and `#` prefixes are skipped. |
| `searchMode` | `hybrid` | `hybrid`, `memories` or `chunks`. |
| `threshold` | `0.3` | Minimum relevance. |
| `rerank` | `none` | `none`, `order` or `aggregate`. |
| `recallMaxResults` | `5` | Facts admitted into the automatic recall block. |
| `recallSearchMode` | `memories` | Search surface for recall; extracted memories avoid duplicate chunk rows. |
| `recallThreshold` | `0.5` | Minimum relevance for recall (the tool search keeps `threshold`). |
| `recallFactMaxChars` | `320` | Longest fact shown in the recall block. |
| `recallQueryMaxChars` | `500` | Longest query sent by the recall hook. |
| `recallQueryCacheMs` | `600000` | Share a successful identical recall search between sessions for this long; `0` disables. |
| `recallScope` | `all` | `all` recalls from every project; `project` filters recall to this repository's `project_id`. |
| `recallDedupe` | `true` | Skip facts already injected earlier in the same session (reset after compaction). |
| `discoveryNotice` | `true` | Tell a session once when recall found nothing, so it knows a tool search may help. |
| `recallIncludeRelated` | `false` | Carry graph relations (`updates`/`extends`/`derives`) in the automatic recall block; one relation per fact. |
| `recallRerank` | `inherit` | Reranking for the recall search; `inherit` follows `rerank`. |
| `recallFailureNotice` | `true` | Put an explicit `memory recall unavailable (…)` line into the recall block when recall fails or times out. |
| `profileFrequency` | `20` | Inject the profile every N turns; `0` disables. |
| `profileMaxChars` | `1800` | Character budget for the profile block. |
| `recallMaxChars` | `6000` | Character budget for the whole recall block. |
| `recallTimeoutMs` | `10000` | Recall budget; the turn continues without memory when it expires. |
| `timeoutMs` | `120000` | Timeout for an ordinary API request (a busy local server may need minutes). |
| `dreaming` | `instant` | Processing mode for explicit saves and uploads (`instant` or `dynamic`). |
| `captureDreaming` | `dynamic` | Processing mode for automatic capture; `inherit` follows `dreaming`. `dynamic` groups related captures (better memories, facts appear later), `instant` is immediate and bills an extra operation per document. |
| `captureContext` | durable-memory guidance | Extraction guidance sent with captures (max 1500 chars); set `""` to disable it. |
| `captureTools` | `true` | Include tool calls and their results (named, errors marked) in captures. |
| `captureToolChars` | `800` | Longest tool result text stored per capture. |
| `captureFailureNotice` | `true` | Mention a failed capture in the next recall block instead of only logging it. |
| `captureDebounceMs` | `1200` | Delay before writing a finished turn. |
| `maxCaptureChars` | `120000` | Largest captured transcript body; bigger sessions are split (the stored document adds a short header). |
| `captureTurnsPerChunk` | `25` | Turns per part when a session is too large for one document (minimum 1). |
| `minCaptureChars` | `80` | Shortest session worth capturing. |
| `captureRetries` | `3` | Retries after a failed capture. |
| `captureRetryDelayMs` | `4000` | Base delay between capture retries (multiplied by the attempt). |
| `filter` | `""` | Metadata filter (JSON) for recall in your own namespace. |
| `rewriteQuery` | `false` | Let the server rewrite the recall query (adds ~2–3 s). |
| `searchRetry` | `true` | Retry an empty `supermemory_search` once with rewriting and a broader mode. |
| `profileSectionFacts` | `8` | Facts per profile section before a `+N more` marker. |
| `ingestWaitMs` | `1500` | How long `supermemory_save` waits for processing before returning. |
| `allowFileUpload` | `false` | Allow `supermemory_upload_file` to read local files at all. |
| `uploadRoots` | `[]` | Directories an upload may read from; empty means none. |
| `maxUploadBytes` | `20971520` | Largest file an upload may send (20 MiB). |
| `redactSecrets` | `true` | Strip credential-shaped strings from captured transcripts. |

### Reading another agent's memory

Cross-agent reads are deliberately off. To recall Hermes' memory (read-only), add an override:

```yaml
- id: supermemory
  name: '@local/dsh-supermemory'
  config:
    readContainers: [hermes_default]
    readPrefixes: [hermes]
```

## Tools

| Tool | What it does |
|---|---|
| `supermemory_search` | Semantic search over readable namespaces. Accepts a typed metadata `filter`, `threshold`, `rerank`, `rewriteQuery`, and `includeRelated` / `includeForgotten` / `includeDocuments`; results carry dates, state, relation chains and memory ids. |
| `supermemory_memory_history` | One memory by id: current text, version chain (nearest first), `extends`/`derives` links, dates, `isLatest`/`isInference`/`isForgotten`, and an optional source-document excerpt. Read-only. |
| `supermemory_profile` | Persistent facts and recent context, optionally with a query, a metadata `filter`, or selected `buckets`. |
| `supermemory_save` | Store a document in a writable namespace with an optional `date`, `group` and `dreaming` mode, and report the ingest status. |
| `supermemory_save_many` | Store 1–50 focused documents in one batch call (redacted), for indexing a project or a set of decisions. |
| `supermemory_forget` | Preview matches, then delete by id or description with `confirm: "delete"`. |
| `supermemory_read_document` | Read a stored document by id with pagination and its status. |
| `supermemory_list` | Browse documents, chunks or memories with paging, `sort`/`order`, a metadata `filter`, and forgotten inclusion. |
| `supermemory_namespaces` | Connection check and the namespace inventory with counts and paging. |
| `supermemory_upload_file` | Send a local file (PDF, image, text, office) — only inside `uploadRoots`. |
| `supermemory_namespace` | List namespaces, show a namespace's `supportingContext`, set it, delete (writable only, `confirm`). |
| `supermemory_buckets` | List, set and delete profile buckets in your own namespace; deletion needs `confirm: "delete"`. |

## Bundled skill

The bundle registers a `supermemory` skill with the Harness skill catalog. The model can load it
with the `skill` tool when a task depends on earlier work; it contains the procedure the tool
descriptions cannot: when to search and when not to, what makes a durable fact, how to read one
memory's history, how to index a repository without storing secrets or transient state, how to
forget safely, and the rule that recalled text is untrusted data.

## What you can ask it

The point of the read path is that memory answers questions about *time and change*, not
just similarity. With the tools above the agent can:

- **"What did I say / decide about X?"** — `supermemory_search` with the topic, then
  `supermemory_memory_history` on a fact's id when the exact earlier wording matters.
- **"How did my position change?"** — `supermemory_search` with `includeRelated: true` shows
  `updates` / `extends` / `derives` links with dates; forgotten or replaced versions show up with
  `includeForgotten: true` and a `superseded`/`forgotten` marker.
- **"Which decisions were made, and when?"** — save decisions with a `date` and
  `group: {project, kind: "decision"}` and then filter on them
  (`{"field":"kind","operator":"eq","value":"decision"}`), sorted by date, instead of hoping
  semantic search ranks them.
- **"What did we do in this project?"** — `supermemory_list` over documents with
  `sort: "updatedAt"`, or a filtered search scoped to the project group.

A personal namespace starts with only the `preferences` bucket. If you want the profile to keep
decisions, project state and hard constraints separately, add them once (the bundle never changes
server-side bucket state by itself):

```text
supermemory_buckets → action: set, buckets: {"decisions": "Decisions the operator made and their dates",
                                            "projects": "Active projects and their current state",
                                            "constraints": "Hard constraints and non-goals"}
```

## Security model

What the plugin guarantees:

- **No secrets in this repository**, and the API key never appears in logs, errors, or tool output
  (tool results do return stored memory text, but server error *bodies* are never relayed: an error
  names the endpoint, the HTTP status, and a stable machine code, with a fixed hint for common
  statuses, so an endpoint that echoes the key or writes instructions cannot put either into the
  model context). The key is resolved per request from the credential store.
- **Writes stay inside your namespaces.** `writeContainers` cannot name a Hermes namespace, and
  `allowWritesToReadContainers` never extends to one. Namespace deletion is an allowlist: only a
  namespace this agent may write can be deleted, never its own, and there is no `moveTo`.
- **Recalled text cannot forge its own block.** The recall block is delimited by a fresh random
  nonce per turn; recalled and profile text is stripped of control characters, the legacy
  `<supermemory-context>` tag, and leading `##` heading markers before it is shown.
- **Captures are redacted.** Credential shapes (`sm_…`, `sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, PEM
  blocks, `"apiKey": "…"`) are replaced with `[redacted]` before a transcript is sent.
- **Capture only retires documents it wrote.** Before deleting the legacy single document of a
  session, the plugin re-reads it and requires its own `session_id` and agent metadata, so a note
  saved under a colliding id is never removed.
- **Document text is framed as untrusted.** `supermemory_read_document` sanitizes its header and
  wraps the (otherwise exact) body in its own nonce-delimited region with a warning line.
- **Uploads are off by default** and confined to `uploadRoots`; the file must have a single hard
  link, is opened with `O_NOFOLLOW` where the platform provides it (Windows falls back to a plain
  open after the link check), and is read through that descriptor with a byte cap.
- **Memory, namespace and bucket deletion need a second step.** `supermemory_forget` previews
  description matches and deletes only with `confirm: "delete"` (deleting by memory id needs the same
  confirmation but has no preview); namespace and bucket deletion require `confirm: "delete"` too.

What it does **not** guarantee:

- The server sees what you capture: the user's questions on recall and the session transcript on
  capture. With the cloud server, that data leaves the machine.
- Namespace isolation is enforced by this plugin, not by the server: the server's API is
  account-wide, so one key reaches every namespace. Use separate keys/servers if you need real
  isolation.
- Data at rest is the server's responsibility.

See [SECURITY.md](SECURITY.md) for how to report a problem.

## Verify

```bash
node --check index.js && node --check scripts/setup.mjs
node scripts/check.mjs      # manifest, patch, locales, README defaults, single-image detail, secrets
npm install --no-save --no-package-lock @deepseek-ai/schemastery@3.19.0   # Config-schema tests
npm test                     # 197 cases (6 live cases skip without a temporary namespace);
                            # without the line above, 3 Config tests skip
```

Live check after install: `supermemory_namespaces` lists the server and your namespace;
`supermemory_search` finds something you saved; after a turn, a document appears in your namespace.
If you have no Hermes data yet, a search about Hermes legitimately returns nothing.

The opt-in live suite writes only into a throwaway namespace named `dsh-audit-<YYYYMMDD-HHMM>`,
reads real memories from your own `dsh` namespace to exercise the history tool, and deletes the
temporary namespace at the end:

```bash
DSH_SM_LIVE_CONTAINER=dsh-audit-20260101-1200 \
SUPERMEMORY_API_KEY="$(cat ~/.supermemory/api-key)" \
node --test test/live.test.mjs
```

It refuses any other namespace name and refuses a namespace that already existed before the run. On a self-hosted server whose extraction model is unavailable
(`memory agent failed` in the server log) documents are written and searchable as chunks but new
memories do not form; the extraction-dependent checks then report that explicitly instead of
passing.

## Architecture and limits

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how recall, capture, chunking, filters, buckets and
  namespaces work (Russian).
- [docs/API-COVERAGE.md](docs/API-COVERAGE.md) — which v5 paths and parameters are used, which are
  deliberately not, and the test for each item.
- [CHANGELOG.md](CHANGELOG.md) — release notes, including breaking changes.
- Capture uses the message list of the session: after compaction the transcript reflects the
  compacted view, so chunk contents can be rewritten (ids stay stable).
- Recall runs on the first step of a turn only; it is budgeted (`recallMaxChars`, `recallTimeoutMs`)
  and a failed recall is reported in the block instead of being silent.
- Ingest is asynchronous: a saved document becomes searchable after the server processes it.
  Memories (and therefore version chains) come from a second, "dreaming" phase: with
  `dreaming: instant` they appear right after processing and cost one extra billed operation per
  document, while `dynamic` groups related documents for better context and can take minutes. A
  self-hosted server needs a working extraction model for this phase; without it, documents are
  still stored and searchable as chunks.

## License

MIT — see [LICENSE](LICENSE). Русская версия: [README.ru.md](README.ru.md).
