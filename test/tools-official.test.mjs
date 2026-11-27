import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './host.mjs'
import { internals } from '../index.js'

const { resolveSettings } = internals
const signal = () => ({ signal: new AbortController().signal })

test('settings gain the official-plugin defaults without touching the old keys', () => {
  const settings = resolveSettings({})
  assert.equal(settings.recallMaxResults, 5)
  assert.equal(settings.recallSearchMode, 'memories')
  assert.equal(settings.recallThreshold, 0.5)
  assert.equal(settings.recallFactMaxChars, 320)
  assert.equal(settings.recallQueryMaxChars, 500)
  assert.equal(settings.recallQueryCacheMs, 600000)
  assert.equal(settings.recallScope, 'all')
  assert.equal(settings.recallDedupe, true)
  assert.equal(settings.discoveryNotice, true)
  assert.equal(settings.captureTools, true)
  assert.equal(settings.captureToolChars, 800)
  assert.equal(settings.captureFailureNotice, true)
  assert.equal(settings.captureDreaming, 'dynamic')
  assert.equal(settings.minQueryChars, 12)
  assert.equal(settings.searchRetry, true)
  assert.equal(settings.profileSectionFacts, 8)
  assert.match(settings.captureContext, /Durable memory guidance/)
  // Existing keys keep their values.
  assert.equal(settings.searchMode, 'hybrid')
  assert.equal(settings.threshold, 0.3)
  assert.equal(settings.maxRecallResults, 6)
})

test('an empty search is retried once with rewriting and a broader mode', async () => {
  let searches = 0
  const host = await createHost({
    fetchHandler: url => {
      if (!url.includes('/search')) return { body: {} }
      searches += 1
      return searches === 1
        ? { body: { results: [] } }
        : { body: { results: [{ id: 'm1', memory: 'the deploy decision was Tuesday', similarity: 0.6 }] } }
    },
  })
  try {
    const tool = host.tools.get('supermemory_search')
    const result = await tool.execute({ query: 'what did we decide about the release deploy?', mode: 'memories' }, signal())
    const calls = host.calls.filter(call => call.url.includes('/search'))
    assert.equal(calls.length, 2)
    const retry = JSON.parse(String(calls[1].body))
    assert.equal(retry.rewriteQuery, true)
    assert.equal(retry.searchMode, 'hybrid')
    assert.match(result.text, /retried with a rewritten hybrid query/)
    assert.match(result.text, /deploy decision was Tuesday/)
  } finally {
    host.restore()
  }
})

test('searchSchema bounds the query and documents the memory-id routing', async () => {
  const host = await createHost()
  try {
    const tool = host.tools.get('supermemory_search')
    assert.equal(tool.parameters.properties.query.maxLength, 1000)
    assert.match(tool.description, /supermemory_profile/)
    assert.match(tool.description, /supermemory_memory_history/)
  } finally {
    host.restore()
  }
})

test('save forwards an explicit dreaming mode and explains that facts form later', async () => {
  const writes = []
  const host = await createHost({
    fetchHandler: (url, init = {}) => {
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'dsh-note', status: 'queued' } }
      }
      return { body: { system: { status: 'done' } } }
    },
  })
  try {
    const tool = host.tools.get('supermemory_save')
    const result = await tool.execute({
      content: 'Decision: the deploy window is Tuesday.',
      documentId: 'dsh-note',
      dreaming: 'instant',
      date: '2026-11-20',
      group: { project: 'acme', kind: 'decision' },
    }, signal())
    assert.equal(writes[0].dreaming, 'instant')
    assert.equal(writes[0].metadata.project, 'acme')
    assert.match(result.text, /facts may still be forming|extracted in the background/)
  } finally {
    host.restore()
  }
})

test('upload works end to end and stamps the project identity', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-upload-'))
  const file = join(dir, 'note.txt')
  writeFileSync(file, 'a durable convention worth remembering')
  let form
  const host = await createHost({
    config: { allowFileUpload: true, uploadRoots: [dir] },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'POST' && url.endsWith('/document/file')) {
        form = init.body
        return { body: { id: 'file-1', status: 'queued' } }
      }
      return { body: { system: { status: 'done' } } }
    },
  })
  try {
    const tool = host.tools.get('supermemory_upload_file')
    const result = await tool.execute({ path: file, title: 'Note' }, signal())
    assert.equal(result.documentId, 'file-1')
    assert.match(result.text, /Uploaded note\.txt/)
    const metadata = JSON.parse(form.get('metadata'))
    assert.match(metadata.project_id, /^[0-9a-f]{16}$/)
    assert.equal(metadata.file_name, 'note.txt')
    const group = JSON.parse(form.get('group'))
    assert.equal(group.kind, 'file')
    assert.match(group.project_id, /^[0-9a-f]{16}$/)
  } finally {
    host.restore()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a single save redacts credentials and stamps the project from the execution context', async () => {
  const writes = []
  const host = await createHost({
    fetchHandler: (url, init = {}) => {
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'dsh-note', status: 'queued' } }
      }
      return { body: { system: { status: 'done' } } }
    },
  })
  try {
    const tool = host.tools.get('supermemory_save')
    const result = await tool.execute({
      content: `The staging key is sm_${'B'.repeat(50)} and it must not be stored.`,
      documentId: 'dsh-note',
    }, { signal: new AbortController().signal, agent: { session: { header: { cwd: '/Users/dev/private/project' } } } })
    assert.equal(writes[0].content.includes('sm_BBBB'), false, 'a credential reached the save write')
    assert.match(result.text, /Stored document dsh-note/)
    assert.match(writes[0].metadata.project_id, /^[0-9a-f]{16}$/)
    assert.match(writes[0].group.project_id, /^[0-9a-f]{16}$/)
  } finally {
    host.restore()
  }
})

test('batch save posts redacted focused documents and reports partial failures', async () => {
  const writes = []
  const host = await createHost({
    fetchHandler: (url, init = {}) => {
      if (init.method === 'POST' && url.endsWith('/document/batch')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: {
          results: [{ id: 'a', status: 'queued' }, { id: 'b', status: 'failed', error: 'bad content', code: 'invalid' }],
          count: 1,
          failed: 1,
        } }
      }
      return { body: {} }
    },
  })
  try {
    const tool = host.tools.get('supermemory_save_many')
    const result = await tool.execute({
      documents: [
        { content: 'Architecture: the API is a single Go service with SQLite.', title: 'stack', date: '2026-11-01', group: { project: 'acme', kind: 'architecture' } },
        { content: `Setup needs the key sm_${'A'.repeat(50)} stored locally.`, documentId: 'setup' },
      ],
    }, signal())
    const body = writes[0]
    assert.equal(body.documents.length, 2)
    assert.equal(body.taskType, 'memory')
    assert.equal(body.documents[0].metadata.project, 'acme')
    assert.equal(body.documents[0].metadata.kind, 'architecture')
    assert.equal(body.documents[0].date, '2026-11-01T00:00:00.000Z')
    assert.equal(body.documents[1].content.includes('sm_AAAA'), false, 'a key reached the batch write')
    assert.match(result.text, /Stored 1 of 2 document\(s\)/)
    assert.match(result.text, /failed: b \(invalid\)/)
  } finally {
    host.restore()
  }
})

test('batch save redacts context, title and group values, not only content', async () => {
  const writes = []
  const host = await createHost({
    fetchHandler: (url, init = {}) => {
      if (init.method === 'POST' && url.endsWith('/document/batch')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { results: [{ id: 'a', status: 'queued' }], count: 1, failed: 0 } }
      }
      return { body: {} }
    },
  })
  try {
    const tool = host.tools.get('supermemory_save_many')
    await tool.execute({
      documents: [{
        content: 'a durable architecture decision about the API',
        title: `note ${'sm_' + 'C'.repeat(50)}`,
        context: `focus on ${'sm_' + 'D'.repeat(50)}`,
        group: { project: `${'sm_' + 'E'.repeat(50)}`, kind: 'architecture' },
      }],
    }, signal())
    const body = JSON.stringify(writes[0])
    assert.equal(body.includes('sm_CCCC'), false, 'a title secret was sent')
    assert.equal(body.includes('sm_DDDD'), false, 'a context secret was sent')
    assert.equal(body.includes('sm_EEEE'), false, 'a group secret was sent')
  } finally {
    host.restore()
  }
})

test('batch save validates every document before the network', async () => {
  const host = await createHost()
  try {
    const tool = host.tools.get('supermemory_save_many')
    await assert.rejects(() => tool.execute({ documents: [] }, signal()), /1-50/)
    await assert.rejects(() => tool.execute({ documents: [{ content: 'tiny' }] }, signal()), /meaningful text/)
    await assert.rejects(() => tool.execute({ documents: [{ content: 'a real durable decision text', date: 'yesterday' }] }, signal()), /ISO 8601/)
    assert.equal(host.calls.length, 0)
  } finally {
    host.restore()
  }
})

test('forget ids needs a confirmation, deletes the list and reports per-id refusals', async () => {
  const deletes = []
  const host = await createHost({
    fetchHandler: (url, init = {}) => {
      if (init.method === 'DELETE' && url.endsWith('/memories')) {
        deletes.push(JSON.parse(String(init.body)))
        return { body: { count: 1, errors: [{ id: 'm2', error: 'hidden', code: 'not_found' }] } }
      }
      return { body: {} }
    },
  })
  try {
    const tool = host.tools.get('supermemory_forget')
    await assert.rejects(() => tool.execute({ memoryIds: ['m1', 'm2'] }, signal()), /confirm/)
    const result = await tool.execute({ memoryIds: ['m1', 'm2'], confirm: 'delete' }, signal())
    assert.deepEqual(deletes[0], { ids: ['m1', 'm2'] })
    assert.match(result.text, /Forgotten 1 of 2 memory\(ies\)/)
    assert.match(result.text, /not forgotten: m2 \(not_found\)/)
    assert.equal(result.text.includes('hidden'), false, 'server refusal text was relayed')
  } finally {
    host.restore()
  }
})

test('a semantic forget preview lists ids, caps candidates and asks for the confirmed call', async () => {
  const matches = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, memory: `old fact number ${index}` }))
  const host = await createHost({
    fetchHandler: url => (url.includes('/memories/semantic') ? { body: { count: matches.length, errors: [], matches } } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_forget')
    const preview = await tool.execute({ query: 'old facts' }, signal())
    assert.match(preview.text, /- m0 old fact number 0/)
    assert.match(preview.text, /Call supermemory_forget again with memoryIds/)
    assert.equal((preview.text.match(/- m\d /g) || []).length, 5)
  } finally {
    host.restore()
  }
})

test('list renders pagination totals, the next page and the read hint', async () => {
  const host = await createHost({
    fetchHandler: url => (url.includes('/list/documents') ? {
      body: {
        documents: [{ id: 'doc-1', title: 'session notes', system: { status: 'done', createdAt: '2026-11-20T00:00:00Z' } }],
        pagination: { currentPage: 1, limit: 10, totalItems: 42, totalPages: 3 },
      },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_list')
    const result = await tool.execute({ type: 'documents' }, signal())
    assert.match(result.text, /page 1 of 3, 42 item\(s\) total/)
    assert.match(result.text, /More available - call supermemory_list with page: 2\./)
    assert.match(result.text, /Use supermemory_read_document with a document id/)
    assert.match(result.text, /- \[doc-1\] "session notes" \(done, 2026-11-20\)/)
  } finally {
    host.restore()
  }
})

test('profile renders stable, recent and bucket sections with an overflow marker', async () => {
  const host = await createHost({
    config: { profileSectionFacts: 2 },
    fetchHandler: url => (url.includes('/profile') ? {
      body: { profile: {
        static: [{ id: 's1', memory: 'stable one' }, { id: 's2', memory: 'stable two' }, { id: 's3', memory: 'stable three' }],
        dynamic: [{ id: 'd1', memory: 'recent one' }],
        buckets: { decisions: [{ id: 'b1', memory: 'decision one' }] },
      } },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_profile')
    const result = await tool.execute({}, signal())
    assert.match(result.text, /## Stable Context/)
    assert.match(result.text, /## Recent Context/)
    assert.match(result.text, /## Bucket `decisions`/)
    assert.match(result.text, /- \+1 more/)
  } finally {
    host.restore()
  }
})

test('the plugin registers a bundled memory skill and a substantive-turn policy prompt', async () => {
  const host = await createHost()
  try {
    assert.equal(host.skills.length, 1, 'the memory skill was not registered')
    const skill = host.skills[0]
    assert.equal(skill.name, 'supermemory')
    assert.match(skill.description, /durable/i)
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
    assert.match(skill.content, /untrusted data/)
    assert.match(skill.content, /supermemory_save_many/)
    assert.match(skill.content, /memoryId/)
    const prompt = host.sections[0].text()
    assert.match(prompt, /At the start of a substantive task/)
    assert.match(prompt, /supermemory_memory_history/)
    assert.match(prompt, /Never present another agent/)
  } finally {
    host.restore()
  }
})
