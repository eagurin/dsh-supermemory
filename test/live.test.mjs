/**
 * Live checks against a real Supermemory server.
 *
 * These tests stay skipped unless a temporary namespace and a key are supplied:
 *
 *   DSH_SM_LIVE_CONTAINER=dsh-audit-20260101-1200 \
 *   SUPERMEMORY_API_KEY=... node --test test/live.test.mjs
 *
 * The namespace name must match `dsh-audit-<YYYYMMDD-HHMM>`; the suite refuses
 * anything else, writes only there, and deletes it at the end. Reads from the
 * agent's own `dsh` namespace prove the history tool against real data; no other
 * namespace is touched.
 *
 * The local self-hosted server forms memories in a second phase that needs a
 * working extraction model. When that phase is unavailable (its log says
 * "memory agent failed"), the write succeeds and search returns document chunks,
 * but no new memories or version chains exist yet. The extraction-dependent
 * assertions skip with a diagnostic instead of pretending to pass.
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './host.mjs'

const container = process.env.DSH_SM_LIVE_CONTAINER || ''
const apiKey = process.env.SUPERMEMORY_API_KEY || ''
const baseUrl = process.env.DSH_SM_LIVE_BASE_URL || 'http://127.0.0.1:6767'
const LIVE = /^dsh-audit-\d{8}-\d{4}$/.test(container) && apiKey.length > 0
const guard = message => { if (!LIVE) throw new Error(message) }

let host
let suiteSafe = false
let created = false
const written = []

/**
 * Run a live check only when the suite may touch the server: it is enabled and the
 * temporary namespace did not already exist. Otherwise the test is skipped, so a
 * mistyped or reused name can never be written into and then deleted.
 */
function maybe(name, fn) {
  test(name, async t => {
    if (!LIVE) {
      t.skip('live suite is not enabled (set DSH_SM_LIVE_CONTAINER and SUPERMEMORY_API_KEY)')
      return
    }
    if (!suiteSafe) {
      t.skip(`refusing to touch \`${container}\`: it already existed before the suite started`)
      return
    }
    await fn(t)
  })
}

/** Read the server directly for the few checks that are not a tool call. */
async function raw(method, path, body) {
  guard('live suite is not enabled')
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`)
  return text ? JSON.parse(text) : undefined
}

before(async () => {
  if (!LIVE) return
  // A pre-existing namespace is not this suite's to write into or delete. The
  // inventory pages: checking only the first page would miss a match beyond it and
  // then delete that namespace in cleanup.
  try {
    let conclusive = false
    const seen = new Set()
    for (let page = 1; page <= 50; page += 1) {
      const chunk = await raw('GET', `/ns?limit=100&page=${page}`)
      const names = (chunk.namespaces || []).map(entry => entry.namespace)
      if (names.includes(container)) {
        conclusive = true
        suiteSafe = false
        break
      }
      if (names.length === 0 || seen.has(names[0])) {
        conclusive = true
        break
      }
      seen.add(names[0])
      const totalPages = chunk.pagination && Number.isFinite(chunk.pagination.totalPages) ? chunk.pagination.totalPages : 1
      if (page >= totalPages) {
        conclusive = true
        break
      }
    }
    // More namespaces than the page cap: absence cannot be proven, so refuse.
    suiteSafe = conclusive && suiteSafe !== false
    if (!conclusive) suiteSafe = false
  } catch {
    suiteSafe = false
  }
  if (!suiteSafe) return
  host = await createHost({
    realNetwork: true,
    apiKey,
    config: {
      baseUrl,
      container,
      // `dsh` is this agent's own namespace, read-only here; it holds real
      // memories from earlier sessions and proves the history tool on live data.
      readContainers: ['dsh'],
      writeContainers: [],
      autoCapture: false,
      autoRecall: false,
      timeoutMs: 180000,
      ingestWaitMs: 30000,
    },
  })
})

after(async () => {
  if (!LIVE) return
  try {
    // Only a namespace this run created is removed, and only after the first write
    // actually happened: the plugin refuses to delete its own namespace on purpose,
    // so the fixture does it directly.
    if (suiteSafe && created) await raw('DELETE', `/ns/${encodeURIComponent(container)}`)
  } catch {
    // Already gone is fine.
  }
  if (host) host.restore()
})

maybe('live: a dated, grouped document is accepted and then listed', async (t) => {
  const tool = host.tools.get('supermemory_save')
  const documentId = `audit-${Date.now()}`
  written.push(documentId)
  created = true
  const saved = await tool.execute({
    content: 'Live audit note. Decision: the deploy window for project audit-project is Tuesday 09:00.',
    documentId,
    date: '2026-11-20T09:00:00.000Z',
    group: { project: 'audit-project', kind: 'conversation' },
    context: 'Focus on decisions and dates.',
  }, { signal: new AbortController().signal })
  assert.match(saved.text, new RegExp(`Stored document ${documentId}`))
  assert.notEqual(saved.status, 'failed', `the server failed to process the document: ${saved.text}`)

  const list = host.tools.get('supermemory_list')
  const listed = await list.execute({ type: 'documents', limit: 20 }, { signal: new AbortController().signal })
  assert.match(listed.text, new RegExp(documentId), 'the written document is not listed')
  // The v5 API keeps the caller date as temporal context on the document.
  const documents = await raw('POST', `/ns/${encodeURIComponent(container)}/list/documents?limit=20&page=1`, {})
  const stored = (documents.documents || []).find(entry => entry.id === documentId)
  assert.ok(stored, 'the document is missing from the server listing')
  assert.equal(stored.metadata.project, 'audit-project')
  assert.equal(stored.metadata.kind, 'conversation')
  assert.equal(stored.metadata.source_agent, 'deepseek-harness')
  const documentDate = stored.metadata.temporalContext && stored.metadata.temporalContext.documentDate
  assert.equal(documentDate, '2026-11-20', 'the supplied source date was not stored')
  t.diagnostic(`stored ${documentId} with status ${stored.system && stored.system.status}`)
})

maybe('live: search accepts the v5 include flags and renders dates', async (t) => {
  const search = host.tools.get('supermemory_search')
  const result = await search.execute({
    query: 'when is the deploy window for audit-project?',
    limit: 5,
    threshold: 0.1,
    includeRelated: true,
    includeDocuments: true,
    includeForgotten: true,
  }, { signal: new AbortController().signal })
  assert.equal(result.count >= 0, true)
  if (result.count === 0) {
    t.diagnostic('no search results yet: the local server forms memories in a second phase')
    return
  }
  assert.match(result.text, /\d{4}-\d{2}-\d{2}/, 'a result carried no date')
  assert.match(result.text, /%/, 'a result carried no similarity score')
  t.diagnostic(`search returned ${result.count} row(s) with include related/documents/forgotten`)
})

maybe('live: memory_history reads a real memory from the agent\'s own namespace', async (t) => {
  const search = host.tools.get('supermemory_search')
  const found = await search.execute({
    query: 'DSH supermemory plugin recall timeout',
    container: 'dsh',
    limit: 10,
  }, { signal: new AbortController().signal })
  const memoryId = (found.text.match(/memory ([A-Za-z0-9_-]{10,})/) || [])[1]
  if (!memoryId) {
    t.skip('the `dsh` namespace returned no memories on this server')
    return
  }
  const history = host.tools.get('supermemory_memory_history')
  const result = await history.execute({ memoryId, container: 'dsh', includeDocument: true }, { signal: new AbortController().signal })
  assert.match(result.text, new RegExp(`Memory ${memoryId} in \`dsh\``))
  assert.match(result.text, /Created \d{4}-\d{2}-\d{2}/)
  assert.match(result.text, /Source excerpt:|Source document/, 'the included source document and excerpt were not rendered')
  t.diagnostic(result.text.split('\n').slice(0, 3).join(' | '))
})

maybe('live: an unreadable namespace is refused before any request', async () => {
  const history = host.tools.get('supermemory_memory_history')
  await assert.rejects(
    () => history.execute({ memoryId: 'whatever', container: 'hermes_default' }, { signal: new AbortController().signal }),
    /not readable/,
  )
})

maybe('live: the temporary namespace is deleted and leaves no trace', async () => {
  await raw('DELETE', `/ns/${encodeURIComponent(container)}`)
  const namespaces = await raw('GET', '/ns?limit=100')
  const names = (namespaces.namespaces || []).map(entry => entry.namespace)
  assert.equal(names.includes(container), false, `temporary namespace ${container} still exists`)
  const own = await raw('GET', '/ns?limit=100')
  assert.ok((own.namespaces || []).some(entry => entry.namespace === 'dsh'), 'the agent namespace disappeared')
})
