# Security policy

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** in this
repository (private advisory). Please do not open a public issue for a secret
leak, an unexpected network destination, or a way to read or write another
agent's memory.

Expect an answer within a few days. Include the version, the configuration of the
Loader row, and what the plugin did instead of what you expected.

## What this plugin promises, and what it does not

Does:

- **No credentials in the repository.** The bundle stores only the *name* of a
  credential reference (`SUPERMEMORY_API_KEY`); the value lives in the Host
  credential store (`$DSH_HOME/.credentials.yaml`) and is resolved per request.
- **The key never appears in logs or errors.** The plugin never interpolates it; errors
  name the reference and the endpoint. A failed request reports the endpoint, the HTTP
  status, and — only when the server sends an identifier-shaped `code` that does not
  contain the key — that code, plus a fixed hint for common statuses. **Server error bodies
  are never relayed**, so an endpoint that echoes the `Authorization` header or writes
  instructions cannot put either into the model context. Refusal entries are rendered as
  ids and codes only: a bare string entry that is not identifier-shaped is reported as an
  unidentified entry, never echoed. The key is never sent anywhere except as the `Authorization` header to
  `baseUrl`.
- **Agent isolation by default.** The plugin writes only to its own namespace.
  Another agent's namespaces are readable only when explicitly listed in
  `readContainers` or matched by `readPrefixes` (both empty by default), `writeContainers`
  refuses a Hermes name,
  `allowWritesToReadContainers` never extends to one, and namespace deletion is an
  allowlist of writable namespaces with no `moveTo`.
- **Recalled text cannot forge its own block.** The recall block is delimited by a
  fresh random nonce per turn; control characters (including bare carriage returns, which
  Markdown also treats as line endings), the legacy `<supermemory-context>` tag, forged
  `<<<supermemory-…>>>` shapes and leading `##` heading markers are stripped from recalled
  facts and profile text before they are shown. `supermemory_read_document` keeps the
  document body exact but wraps it in its own nonce-delimited region with a warning line.
- **Capture only retires documents it wrote.** Deleting a legacy single document requires
  re-reading it and matching this plugin's `session_id` and agent metadata first, so a
  saved note that happens to share the id is left alone.
- **Captures and explicit writes are redacted.** Credential shapes (`sm_…`, `sk-…`,
  `ghp_…`, `AKIA…`, `Bearer …`, JWTs, URL credentials, `KEY=value`/`KEY: value`
  assignments, PEM blocks, `"apiKey": "…"`) are replaced with `[redacted]` before a
  transcript or a `supermemory_save` / `supermemory_save_many` write leaves the process.
  Documentation placeholders (`${VAR}`, `your-token-here`, `changeme`) are preserved.
  `<private>…</private>` spans are redacted, and a fully private turn is not captured.
- **Uploads are off by default**, confined to `uploadRoots`, required to have a single
  hard link, opened with `O_NOFOLLOW` where the platform provides it (Windows falls back
  to a plain open after the link check), and read through that descriptor with a byte cap.
- **Destructive actions take two steps.** `supermemory_forget` previews description
  matches and deletes only with `confirm: "delete"` (deleting by memory id needs the same
  confirmation without a preview); namespace and bucket deletion require it too.
- **No dependency runs code at install time.** The only dependency is
  `@deepseek-ai/schemastery` (the Config schema), with no
  `preinstall`/`install`/`postinstall` scripts in its tree.
- **No telemetry.** The only network destination is the configured `baseUrl`.

Does not:

- **Control what leaves the machine.** Recall sends the user's question and
  capture sends the session transcript to the configured server. With the
  self-hosted local server that server is on the same machine; with Supermemory
  Cloud both travel to Supermemory. That is the point of memory, but it is a
  deliberate choice, not a default to assume.
- **Protect a compromised Host.** The plugin trusts the Host's credential service
  and session objects; it does not sandbox them.
- **Encrypt local storage.** Data at rest is the server's responsibility
  (`npx supermemory local start` keeps its own store).
- **Isolate namespaces server-side.** The Supermemory API is account-wide: one key
  reaches every namespace. Namespace isolation here is enforced by this plugin, so
  use separate keys or servers if you need a hard boundary.

## Threat model in one line

The plugin is trusted code inside the operator's own DSH profile, talking to one
operator-chosen Supermemory server with one operator-supplied key; the risk it
manages is *cross-agent* data flow (another agent's memory must never be written
or misattributed) and *repository* hygiene (no secrets in a public git history).
