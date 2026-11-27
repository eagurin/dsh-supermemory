import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, hook } from './host.mjs'

function session(id, turns, size) {
  const messages = []
  for (let index = 0; index < turns; index += 1) {
    messages.push({ role: 'user', content: [{ type: 'text', text: `вопрос ${index} ${'q'.repeat(size)}` }], source: { kind: 'user' } })
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `ответ ${index} ${'a'.repeat(size)}` }] })
  }
  return { id, header: { cwd: '/workspace/demo' }, deriveMessages: () => messages }
}

const flushDelay = 60

test('a finished turn is captured as one document with redacted secrets', async () => {
  const written = []
  const host = await createHost({
    config: { captureDebounceMs: 10, container: 'dsh' },
    fetchHandler: (url, init) => {
      if (init.method === 'POST' && url.endsWith('/document')) {
        written.push(JSON.parse(String(init.body)))
        return { body: { id: 'x', status: 'queued' } }
      }
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const s = session('session-int-1', 3, 50)
    s.deriveMessages().push({
      role: 'user',
      content: [{ type: 'text', text: 'here is the key sm_' + 'Z'.repeat(50) }],
      source: { kind: 'user' },
    })
    capture.handler(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, flushDelay))
    assert.equal(written.length, 1, 'expected one document write')
    const document = written[0]
    assert.equal(document.id, 'dsh-session-int-1')
    assert.equal(document.content.includes('sm_ZZZZ'), false, 'a key reached the memory server')
    assert.match(document.content, /\[redacted\]/)
    assert.equal(document.metadata.type, 'conversation')
    assert.equal(document.metadata.turns, 4)
  } finally {
    host.restore()
  }
})

test('a long turn is captured as parts and the earlier single document is deleted', async () => {
  const writes = []
  const deletes = []
  const host = await createHost({
    config: { captureDebounceMs: 10, container: 'dsh', maxCaptureChars: 3000, captureTurnsPerChunk: 5, minCaptureChars: 20 },
    fetchHandler: (url, init) => {
      const body = init.body ? String(init.body) : ''
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(body))
        return { body: { id: 'x', status: 'queued' } }
      }
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'GET' && url.endsWith('/document/dsh-session-int-2')) {
        // Capture retirement only deletes a document it can prove it wrote.
        return { body: { id: 'dsh-session-int-2', metadata: { session_id: 'session-int-2', sm_source: 'dsh', source_agent: 'deepseek-harness' } } }
      }
      if (init.method === 'DELETE' && url.endsWith('/document')) {
        deletes.push(JSON.parse(body))
        return { body: { count: 0, errors: [] } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    capture.handler(session('session-int-2', 12, 200), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, flushDelay))
    assert.ok(writes.length > 1, 'expected chunked writes')
    assert.deepEqual(writes.map(doc => doc.id), writes.map((_, index) => `dsh-session-int-2-p${index + 1}`))
    for (const [index, document] of writes.entries()) {
      assert.equal(document.metadata.chunked, true)
      assert.equal(document.metadata.part, index + 1)
      assert.equal(document.metadata.parts, writes.length)
    }
    assert.deepEqual(deletes.at(-1), { ids: ['dsh-session-int-2'] }, 'the legacy single document was not removed')
  } finally {
    host.restore()
  }
})

test('a capture that fails is retried and does not throw into the turn', async () => {
  let attempts = 0
  const host = await createHost({
    config: { captureDebounceMs: 10, container: 'dsh', captureRetries: 2, captureRetryDelayMs: 40 },
    fetchHandler: (url, init) => {
      // PATCH 404 means "not created yet", so the write continues as POST.
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST') {
        attempts += 1
        return attempts === 1 ? { status: 500, body: { error: 'boom' } } : { body: { id: 'x', status: 'queued' } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    capture.handler(session('session-int-3', 2, 40), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.ok(attempts >= 2, `expected a retry, saw ${attempts} write attempt(s)`)
  } finally {
    host.restore()
  }
})

test('recall is skipped for subagents unless enabled', async () => {
  let searches = 0
  const host = await createHost({
    config: {},
    fetchHandler: url => {
      if (url.includes('/search')) searches += 1
      return { body: { results: [{ memory: 'a recallable fact about the system', similarity: 0.9 }] } }
    },
  })
  try {
    const preStep = hook(host, 'agent/pre-step')
    const decision = { kind: 'enter', messages: [{ role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }] }
    const result = await preStep.handler(
      { agent: { id: 'sub-1', session: { header: { origin: 'subagent' } } }, messages: decision.messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => decision,
    )
    assert.equal(searches, 0)
    assert.equal(result, decision)
  } finally {
    host.restore()
  }
})
