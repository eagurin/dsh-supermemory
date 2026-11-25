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
  `dsh-<sessionId>-p1…pN` when it exceeds `maxCaptureChars`; parts update in place.
- **Ten tools**: search, profile, save, forget, read_document, list, namespaces, upload_file,
  namespace, buckets.

## Requirements

| Need | Detail |
|---|---|
| DSH | `@deepseek-ai/dsh` `0.2.2-rc.1` or newer (`engines.dsh: >=0.2.2-0`). |
| A Supermemory server | Either your own local server or Supermemory Cloud. |
| An API key | Stored in the DSH credential store under `SUPERMEMORY_API_KEY`. |
| Node | 22+ for the interactive setup script (`scripts/setup.mjs`). |

### Choose a server first

| Option | Start it | Key |
|---|---|---|
| Local (recommended for privacy) | `npx supermemory local install` once, then `npx supermemory local start` (port 8787) | `cat ~/.supermemory/api-key` |
| Cloud | nothing to run | create one in the Supermemory console |

The local server listens on `127.0.0.1:8787` by default (`PORT` or `--port` changes it; Hermes setups
often run it on `6767`). The setup script probes both `8787` and `6767`, so it finds your server either way.

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
   plugin_manager install_bundle → git+https://github.com/eagurin/dsh-supermemory.git#v0.5.4
   ```

2. **GUI**: *Settings → Plugins → Install from URL* with
   `git+https://github.com/eagurin/dsh-supermemory.git#v0.5.4`.

3. **CLI**, only if you use `@deepseek-ai/dsh` from npm:

   ```bash
   npx @deepseek-ai/dsh plugin --profile desktop add "git+https://github.com/eagurin/dsh-supermemory.git#v0.5.4"
   ```

The bundle inserts its own `cordis.patch.yml`, so no profile row has to be written by
hand. A plain `pnpm add` inside the profile installs the package but does **not**
select it in `dsh.profile.bundles`, so the plugin stays inactive — use one of the
three paths above.

<details>
<summary>Writing the row by hand (advanced)</summary>

`- id: supermemory` is an **override**: it replaces the config of an existing entry
and is rejected on a fresh profile (`patch: entry "supermemory" not found`). To add
the plugin without selecting the bundle, wrap the row in `insert`:

```yaml
- insert:
    - id: supermemory
      name: '@local/dsh-supermemory'
      config:
        baseUrl: http://127.0.0.1:8787
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

Exporting `SUPERMEMORY_API_KEY` before launching DSH works too and is used as a fallback.

All settings are optional; an override replaces the bundle's `config`, and any key you leave out
falls back to the default below.

| Key | Default | Meaning |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8787` | Supermemory server (the local default port; Hermes setups often use `6767`) or `https://api.supermemory.ai`. |
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
| `minQueryChars` | `3` | Shortest question worth a recall search. |
| `searchMode` | `hybrid` | `hybrid`, `memories` or `chunks`. |
| `threshold` | `0.3` | Minimum relevance. |
| `rerank` | `none` | `none`, `order` or `aggregate`. |
| `profileFrequency` | `20` | Inject the profile every N turns; `0` disables. |
| `profileMaxChars` | `1800` | Character budget for the profile block. |
| `recallMaxChars` | `6000` | Character budget for the whole recall block. |
| `recallTimeoutMs` | `2500` | Recall budget; the turn continues without memory when it expires. |
| `timeoutMs` | `8000` | Timeout for an ordinary API request. |
| `dreaming` | `instant` | Document processing mode (`instant` or `dynamic`). |
| `captureDebounceMs` | `1200` | Delay before writing a finished turn. |
| `maxCaptureChars` | `120000` | Largest single captured document; bigger sessions are chunked. |
| `captureTurnsPerChunk` | `25` | Turns per chunk when a session is too large for one document. |
| `minCaptureChars` | `80` | Shortest session worth capturing. |
| `captureRetries` | `3` | Retries after a failed capture. |
| `captureRetryDelayMs` | `4000` | Base delay between capture retries (multiplied by the attempt). |
| `filter` | `""` | Metadata filter (JSON) for recall in your own namespace. |
| `rewriteQuery` | `false` | Let the server rewrite the recall query (adds ~2–3 s). |
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
| `supermemory_search` | Semantic search over readable namespaces; accepts a metadata `filter` and `rewriteQuery`. |
| `supermemory_profile` | Persistent facts and recent context, optionally with a query. |
| `supermemory_save` | Store a document in a writable namespace and report the ingest status. |
| `supermemory_forget` | Preview matches, then delete by id or description with `confirm: "delete"`. |
| `supermemory_read_document` | Read a stored document by id with pagination and its status. |
| `supermemory_list` | List documents or memories, newest first, with status. |
| `supermemory_namespaces` | Connection check and the namespace inventory with counts. |
| `supermemory_upload_file` | Send a local file (PDF, image, text, office) — only inside `uploadRoots`. |
| `supermemory_namespace` | List namespaces, set `supportingContext`, delete (writable only, `confirm`). |
| `supermemory_buckets` | List, set and delete profile buckets. |

## Security model

What the plugin guarantees:

- **No secrets in this repository**, and no secrets in logs, errors, or tool output. The key is
  resolved per request from the credential store.
- **Writes stay inside your namespaces.** `writeContainers` cannot name a Hermes namespace, and
  `allowWritesToReadContainers` never extends to one. Namespace deletion is an allowlist: only a
  namespace this agent may write can be deleted, never its own, and there is no `moveTo`.
- **Recalled text cannot forge its own block.** The recall block is delimited by a fresh random
  nonce per turn; recalled and profile text is stripped of control characters, closing tags, and
  heading markers before it is shown.
- **Captures are redacted.** Credential shapes (`sm_…`, `sk-…`, `ghp_…`, `AKIA…`, `Bearer …`, PEM
  blocks, `"apiKey": "…"`) are replaced with `[redacted]` before a transcript is sent.
- **Uploads are off by default** and confined to `uploadRoots`; the file is opened with `O_NOFOLLOW`,
  must have a single hard link, and is read through that descriptor with a byte cap.
- **Irreversible actions need a second step.** `supermemory_forget` previews first and only deletes
  with `confirm: "delete"`; namespace deletion needs the same.

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
node --test test/           # 50+ unit tests (the Config tests skip without the optional dependency)
```

Live check after install: `supermemory_namespaces` lists the server and your namespace;
`supermemory_search` finds something you saved; after a turn, a document appears in your namespace.
If you have no Hermes data yet, a search about Hermes legitimately returns nothing.

## Architecture and limits

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how recall, capture, chunking, filters, buckets and
  namespaces work (Russian).
- [CHANGELOG.md](CHANGELOG.md) — release notes, including breaking changes.
- Capture uses the message list of the session: after compaction the transcript reflects the
  compacted view, so chunk contents can be rewritten (ids stay stable).
- Recall runs on the first step of a turn only.
- Ingest is asynchronous: a saved document becomes searchable after the server processes it.

## License

MIT — see [LICENSE](LICENSE). Русская версия: [README.ru.md](README.ru.md).
