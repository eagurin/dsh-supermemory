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
