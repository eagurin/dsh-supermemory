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
- **No credential in logs or errors.** Errors name the reference and the endpoint,
  never the key; `scripts/check.mjs` fails the build on secret-looking strings.
- **Agent isolation by default.** The plugin writes only to its own namespace.
  `hermes*` namespaces are read-only; writing there requires an explicit
  `allowWritesToReadContainers: true`, and recalled Hermes facts are labelled as
  another agent's experience.
- **No dependencies that execute code at install time.** The only dependency is
  `@deepseek-ai/schemastery`, with no `preinstall`/`install`/`postinstall`
  scripts in its tree.
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
  (`npx supermemory local` keeps its own store).

## Threat model in one line

The plugin is trusted code inside the operator's own DSH profile, talking to one
operator-chosen Supermemory server with one operator-supplied key; the risk it
manages is *cross-agent* data flow (another agent's memory must never be written
or misattributed) and *repository* hygiene (no secrets in a public git history).
