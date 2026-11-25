import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, hook } from './host.mjs'
import { internals } from '../index.js'

const { buildTranscriptChunks, resolveSettings } = internals

/** Build a session whose derived messages are supplied verbatim. */
function session(id, messages) {
  return { id, header: { cwd: '/workspace/demo' }, deriveMessages: () => messages }
}

function turn(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function answer(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function checkpoint(text, id) {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'compact-checkpoint' } }
}

test('a compaction checkpoint is kept as a summary and pins a new document family', () => {
  const messages = [checkpoint('earlier work: fixed the model limit', 'cp-1'), turn('now continue'), answer('done')]
  const settings = resolveSettings({ minCaptureChars: 10 })
  const plan = buildTranscriptChunks(session('session-cp', messages), settings)
  assert.equal(plan.documents.length, 1)
  assert.match(plan.documents[0].content, /Summary of earlier turns \(compacted\)/)
  assert.match(plan.documents[0].content, /earlier work: fixed the model limit/)
  assert.notEqual(plan.family, 'g0')
  assert.match(plan.documents[0].documentId, /-c[0-9a-f]{8}$/)
  assert.deepEqual(plan.obsolete, [], 'a post-compaction capture must not retire the earlier family')
})

test('an assistant-only trace is not captured at all', () => {
  const messages = [answer('just an answer, no human turn')]
  const plan = buildTranscriptChunks(session('session-a', messages), resolveSettings({ minCaptureChars: 5 }))
  assert.deepEqual(plan.documents, [], 'assistant-only capture would create a turns: 0 document')
})

test('scheduled and team messages count as turns', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'scheduled job body' }], source: { kind: 'schedule' } },
    answer('ran the job'),
    { role: 'user', content: [{ type: 'text', text: 'message from the team' }], source: { kind: 'team-message' } },
    answer('acknowledged'),
  ]
  const plan = buildTranscriptChunks(session('session-s', messages), resolveSettings({ minCaptureChars: 5 }))
  assert.equal(plan.turns, 2)
  assert.equal(plan.documents.length, 1)
  assert.match(plan.documents[0].content, /\*\*schedule:\*\* scheduled job body/)
  assert.match(plan.documents[0].content, /\*\*team-message:\*\* message from the team/)
})

test('capture content is stable across rebuilds, so unchanged turns are not rewritten', () => {
  const messages = [turn('question one'), answer('answer one')]
  const settings = resolveSettings({ minCaptureChars: 5 })
  const first = buildTranscriptChunks(session('session-h', messages), settings)
  const second = buildTranscriptChunks(session('session-h', messages), settings)
  assert.equal(first.documents[0].content, second.documents[0].content)
})

test('an unchanged session writes nothing on the next turn', async () => {
  const writes = []
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', minCaptureChars: 5 },
    fetchHandler: (url, init) => {
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST') { writes.push(1); return { body: { id: 'x', status: 'queued' } } }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const s = session('session-h2', [turn('question'), answer('answer')])
    capture.handler(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 60))
    capture.handler(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(writes.length, 1, 'the unchanged transcript was written twice')
  } finally {
    host.restore()
  }
})

test('a permanent 4xx is not retried', async () => {
  let attempts = 0
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', minCaptureChars: 5, captureRetries: 3, captureRetryDelayMs: 10 },
    fetchHandler: (url, init) => {
      if (init.method === 'PATCH') { attempts += 1; return { status: 401, body: { error: 'bad key' } } }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    capture.handler(session('session-401', [turn('question'), answer('answer')]), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(attempts, 1, `a 401 was retried ${attempts} times`)
  } finally {
    host.restore()
  }
})

test('two overlapping captures do not delete each other\'s parts', async () => {
  const requests = []
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  let call = 0
  const host = await createHost({
    config: { captureDebounceMs: 1, container: 'dsh', maxCaptureChars: 1200, captureTurnsPerChunk: 2, minCaptureChars: 5 },
    fetchHandler: async (url, init) => {
      const method = init.method || 'GET'
      const body = init.body ? String(init.body) : ''
      requests.push({ method, url, body })
      if (method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (method === 'POST') {
        call += 1
        if (call === 1) await firstGate
        return { body: { id: 'x', status: 'queued' } }
      }
      if (method === 'DELETE') return { body: { count: 1, errors: [] } }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const short = []
    for (let index = 0; index < 10; index += 1) short.push(turn(`q${index}`), answer(`a${index}`))
    const long = [...short]
    for (let index = 10; index < 20; index += 1) long.push(turn(`q${index}`), answer(`a${index}`))

    capture.handler(session('session-race', short), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 30))
    capture.handler(session('session-race', long), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 30))
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 400))

    const deleted = requests.filter(request => request.method === 'DELETE').flatMap(request => JSON.parse(request.body).ids)
    const written = requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body).id)
    const newest = written.at(-1)
    assert.ok(newest, 'nothing was written')
    assert.equal(deleted.includes(newest), false, `the newer capture ${newest} was deleted by an older one`)
  } finally {
    host.restore()
  }
})

test('a checkpoint without an id still opens a new family', () => {
  const messages = [
    checkpoint('summary without an id', undefined),
    turn('continue'),
    answer('ok'),
  ]
  const plan = buildTranscriptChunks(session('session-noid', messages), resolveSettings({ minCaptureChars: 5 }))
  assert.notEqual(plan.family, 'g0', 'a checkpoint without an id fell back to the original family')
  assert.deepEqual(plan.obsolete, [])
})

test('a failed profile fetch degrades instead of breaking the first turn', async () => {
  const host = await createHost({
    config: { profileFrequency: 1, readContainers: [] },
    fetchHandler: url => {
      if (url.includes('/profile')) return { status: 500, body: { error: 'boom' } }
      if (url.includes('/search')) return { body: { results: [{ memory: 'a fact that is long enough', similarity: 0.8 }] } }
      return { body: {} }
    },
  })
  try {
    const preStep = hook(host, 'agent/pre-step')
    const decision = { kind: 'enter', messages: [turn('hello there')] }
    const result = await preStep.handler(
      { agent: { id: 'sess-profile', session: { header: {} } }, messages: decision.messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => decision,
    )
    assert.equal(result.kind, 'enter')
  } finally {
    host.restore()
  }
})

test('the closing marker survives truncation of the recall block', async () => {
  const host = await createHost({
    config: { recallMaxChars: 600, maxRecallResults: 6 },
    fetchHandler: url => (url.includes('/search')
      ? { body: { results: [{ memory: 'о'.repeat(3000), similarity: 0.9 }] } }
      : { body: {} }),
  })
  try {
    const preStep = hook(host, 'agent/pre-step')
    const decision = { kind: 'enter', messages: [turn('что известно')] }
    const result = await preStep.handler(
      { agent: { id: 'sess-long', session: { header: {} } }, messages: decision.messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => decision,
    )
    const text = result.messages.find(message => message.source && message.source.kind === 'supermemory').content[0].text
    const open = text.match(/<<<supermemory-([0-9a-f-]{36})>>>/)
    assert.ok(open, 'no opener')
    assert.ok(text.includes(`<<<end-supermemory-${open[1]}>>>`), 'the closer was clamped away')
    assert.ok(text.length <= 600 + 60, `block ignored the budget: ${text.length}`)
  } finally {
    host.restore()
  }
})

test('a document the server refuses to delete is retried, not forgotten', async () => {
  const deletes = []
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', maxCaptureChars: 1200, captureTurnsPerChunk: 2, minCaptureChars: 5 },
    fetchHandler: (url, init) => {
      const method = init.method || 'GET'
      if (method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (method === 'POST') return { body: { id: 'x', status: 'queued' } }
      if (method === 'DELETE') {
        deletes.push(JSON.parse(String(init.body)).ids)
        return { body: { count: 0, errors: [{ id: 'dsh-session-retry', error: 'Document is still processing' }] } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const messages = []
    for (let index = 0; index < 12; index += 1) messages.push(turn(`q${index} ${'q'.repeat(120)}`), answer(`a${index} ${'a'.repeat(120)}`))
    capture.handler(session('session-retry', messages), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 80))
    capture.handler(session('session-retry', messages), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 120))
    const attempts = deletes.filter(ids => ids.includes('dsh-session-retry'))
    assert.ok(attempts.length >= 2, `the refused deletion was not retried (${attempts.length})`)
  } finally {
    host.restore()
  }
})

test('a surface that shrinks does not delete parts', async () => {
  const deletes = []
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', maxCaptureChars: 1200, captureTurnsPerChunk: 2, minCaptureChars: 5 },
    fetchHandler: (url, init) => {
      const method = init.method || 'GET'
      if (method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (method === 'POST') return { body: { id: 'x', status: 'queued' } }
      if (method === 'DELETE') { deletes.push(JSON.parse(String(init.body)).ids); return { body: { count: 1, errors: [] } } }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const big = []
    for (let index = 0; index < 20; index += 1) big.push(turn(`q${index} ${'q'.repeat(120)}`), answer(`a${index} ${'a'.repeat(120)}`))
    capture.handler(session('session-shrink', big), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 80))
    deletes.length = 0
    capture.handler(session('session-shrink', big.slice(0, 6)), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.deepEqual(deletes, [], 'a shrunken surface deleted documents holding turns')
  } finally {
    host.restore()
  }
})

test('an over-long single turn still produces a document with content', () => {
  const messages = [turn('Z'.repeat(200000)), answer('ok')]
  const settings = resolveSettings({ maxCaptureChars: 5000, minCaptureChars: 5 })
  const plan = buildTranscriptChunks(session('session-huge', messages), settings)
  assert.equal(plan.documents.length, 1)
  const body = plan.documents[0].content.split('## Conversation')[1] || ''
  assert.ok(body.trim().length > 0, 'the document body was empty')
  assert.match(plan.documents[0].content, /Z{100}/)
})

test('two checkpoints with the same summary text land in different families', () => {
  const settings = resolveSettings({ minCaptureChars: 5 })
  const first = buildTranscriptChunks(session('session-cp2', [
    checkpoint('same summary text', undefined),
    turn('first follow-up'),
    answer('a'),
  ]), settings)
  const second = buildTranscriptChunks(session('session-cp2', [
    checkpoint('same summary text', undefined),
    turn('first follow-up'),
    answer('a'),
    checkpoint('same summary text', undefined),
    turn('second follow-up'),
    answer('b'),
  ]), settings)
  assert.notEqual(first.family, second.family, 'two compactions collapsed into one family')
  assert.notEqual(first.family, 'g0')
})

test('session ids that sanitize to the same text do not share a document', () => {
  const settings = resolveSettings({ minCaptureChars: 5 })
  const a = buildTranscriptChunks(session('session/a', [turn('hello there'), answer('hi')]), settings)
  const b = buildTranscriptChunks(session('session a', [turn('hello there'), answer('hi')]), settings)
  assert.notEqual(a.documents[0].documentId, b.documents[0].documentId)
})

test('a non-array deriveMessages result is contained, not thrown', () => {
  const settings = resolveSettings({ minCaptureChars: 5 })
  const broken = { id: 'session-null', header: {}, deriveMessages: () => null }
  assert.deepEqual(buildTranscriptChunks(broken, settings).documents, [])
})

test('tool execute tolerates a missing argument bag instead of throwing a TypeError', async () => {
  const host = await createHost()
  try {
    const tool = host.tools.get('supermemory_list')
    await assert.rejects(() => tool.execute(undefined, { signal: new AbortController().signal }), /missing required argument/)
    const search = host.tools.get('supermemory_search')
    await assert.rejects(() => search.execute(null, { signal: new AbortController().signal }), /missing required argument/)
  } finally {
    host.restore()
  }
})

test('an invalid filter is rejected before any network call', async () => {
  const host = await createHost({ config: { readPrefixes: ['hermes'] } })
  try {
    const tool = host.tools.get('supermemory_search')
    await assert.rejects(
      () => tool.execute({ query: 'x', filter: '{"field":"type","operator":"bogus","value":"x"}' }, { signal: new AbortController().signal }),
      /unsupported operator/,
    )
    assert.equal(host.calls.length, 0, `validation made ${host.calls.length} request(s)`)
  } finally {
    host.restore()
  }
})

test('search reports a memory id only for real memories, never for chunks', () => {
  const facts = internals.mergeFacts([
    { container: 'dsh', results: [
      { memory: 'a real memory row with enough length', id: 'mem-1', similarity: 0.9 },
      { chunk: 'a chunk row with enough length here', id: 'chunk-1', similarity: 0.8 },
    ] },
  ], 5)
  assert.equal(facts.find(fact => fact.text.startsWith('a real')).memoryId, 'mem-1')
  assert.equal(facts.find(fact => fact.text.startsWith('a chunk')).memoryId, undefined)
})

test('a failed namespace discovery degrades instead of breaking a tool call', async () => {
  // The resolver used to reference `log` from outside its scope, so a discovery
  // failure threw ReferenceError and every tool that resolves a container failed.
  const host = await createHost({
    config: { readPrefixes: ['hermes'] },
    fetchHandler: url => {
      if (url.includes('/ns?limit=')) return { status: 500, body: { error: 'boom' } }
      if (url.includes('/list/')) return { body: { documents: [{ id: 'doc-1', title: 'one' }] } }
      return { body: {} }
    },
  })
  try {
    const tool = host.tools.get('supermemory_list')
    const result = await tool.execute({ type: 'documents' }, { signal: new AbortController().signal })
    assert.match(result.text, /doc-1/)
  } finally {
    host.restore()
  }
})
