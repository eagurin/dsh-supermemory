# Changelog

All notable changes to this bundle are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
