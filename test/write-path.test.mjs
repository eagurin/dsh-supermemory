import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, hook } from './host.mjs'
import { internals } from '../index.js'

const { resolveSettings, normalizeGroup, contextGroup } = internals
const flushDelay = 60

/** A session stand-in whose captured messages are supplied verbatim. */
function session(id, messages, header = { cwd: '/Users/someone/private/secret-project' }) {
  return { id, header, deriveMessages: () => messages }
}

function conversation() {
  return [
    { id: 'm1', role: 'user', content: [{ type: 'text', text: 'we decided the deploy window is Tuesday morning' }], source: { kind: 'user' } },
    { role: 'assistant', content: [{ type: 'text', text: 'noted: Tuesday morning deploy window' }] },
  ]
}

/** Collect every document write the capture issued. */
async function captureOnce(config, options = {}) {
  const writes = []
  const host = await createHost({
    config: { captureDebounceMs: 10, container: 'dsh', minCaptureChars: 20, ...config },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'PATCH') {
        if (options.patchFound) {
          writes.push({ method: 'PATCH', url, body: JSON.parse(String(init.body)) })
          return { body: { id: 'x', status: 'queued' } }
        }
        return { status: 404, body: { error: 'Document not found' } }
      }
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push({ method: 'POST', url, body: JSON.parse(String(init.body)) })
        return { body: { id: 'x', status: 'queued' } }
      }
      return { body: {} }
    },
  })
  const capture = hook(host, 'session/event')
  return { host, capture, writes }
}

test('a capture stores the session start date, a project group, taskType and the configured dreaming mode', async () => {
  const { host, capture, writes } = await captureOnce({})
  try {
    const s = session('session-w1', conversation())
    capture.handler(s, { type: 'user/message', time: Date.parse('2026-11-20T10:00:00Z'), data: { id: 'm1' } })
    capture.handler(s, { type: 'turn/end', time: Date.parse('2026-11-20T10:05:00Z'), data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, flushDelay))
    assert.equal(writes.length, 1, 'expected one document write')
    const body = writes[0].body
    assert.equal(body.date, '2026-11-20T10:00:00.000Z', 'the document was dated by the write, not by the session')
    assert.equal(body.group.project, 'secret-project')
    assert.equal(body.group.kind, 'conversation')
    assert.match(body.group.project_id, /^[0-9a-f]{16}$/)
    assert.equal(JSON.stringify(body.group).includes('/Users'), false, 'the group leaked an absolute path')
    assert.equal(body.taskType, 'memory')
    assert.equal(body.dreaming, 'dynamic')
    assert.equal(body.metadata.project, 'secret-project')
    assert.match(body.metadata.project_id, /^[0-9a-f]{16}$/)
    assert.equal(body.metadata.kind, 'conversation')
    assert.equal(body.metadata.type, 'conversation')
  } finally {
    host.restore()
  }
})

test('updating an existing capture sends the same temporal and grouping fields as a create', async () => {
  const { host, capture, writes } = await captureOnce({}, { patchFound: true })
  try {
    const s = session('session-w2', conversation())
    capture.handler(s, { type: 'user/message', time: Date.parse('2026-11-21T08:00:00Z'), data: { id: 'm1' } })
    capture.handler(s, { type: 'turn/end', time: Date.parse('2026-11-21T08:01:00Z'), data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, flushDelay))
    assert.equal(writes.length, 1)
    assert.equal(writes[0].method, 'PATCH')
    const body = writes[0].body
    assert.equal(body.date, '2026-11-21T08:00:00.000Z')
    assert.equal(body.group.project, 'secret-project')
    assert.equal(body.group.kind, 'conversation')
    assert.match(body.group.project_id, /^[0-9a-f]{16}$/)
    assert.equal(body.taskType, 'memory')
    assert.equal(body.dreaming, 'dynamic')
    assert.equal('id' in body, false, 'a PATCH must not repeat the document id in the body')
  } finally {
    host.restore()
  }
})

test('each capture part is dated by its own earliest turn', async () => {
  const messages = []
  for (let index = 0; index < 4; index += 1) {
    messages.push({ id: `m${index}`, role: 'user', content: [{ type: 'text', text: `question ${index} ${'q'.repeat(300)}` }], source: { kind: 'user' } })
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${index} ${'a'.repeat(300)}` }] })
  }
  const writes = []
  const host = await createHost({
    config: { captureDebounceMs: 10, container: 'dsh', minCaptureChars: 20, maxCaptureChars: 1200, captureTurnsPerChunk: 1 },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'x', status: 'queued' } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const s = session('session-w3', messages)
    for (let index = 0; index < 4; index += 1) {
      capture.handler(s, { type: 'user/message', time: Date.parse(`2026-11-2${index}T09:00:00Z`), data: { id: `m${index}` } })
    }
    capture.handler(s, { type: 'turn/end', time: Date.parse('2026-11-24T09:00:00Z'), data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(writes.length >= 2, `expected several parts, got ${writes.length}`)
    assert.equal(writes[0].date, '2026-11-20T09:00:00.000Z')
    assert.equal(writes[1].date, '2026-11-21T09:00:00.000Z')
  } finally {
    host.restore()
  }
})

test('a session with no observed timestamps omits the date instead of inventing one', async () => {
  const { host, capture, writes } = await captureOnce({})
  try {
    capture.handler(session('session-w4', conversation()), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, flushDelay))
    assert.equal(writes.length, 1)
    assert.equal('date' in writes[0].body, false, 'a made-up date was sent')
  } finally {
    host.restore()
  }
})

test('captureContext becomes the extraction guidance of a capture', async () => {
  const { host, capture, writes } = await captureOnce({ captureContext: 'Focus on decisions and dates.' })
  try {
    capture.handler(session('session-w5', conversation()), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, flushDelay))
    assert.equal(writes[0].body.supportingContext, 'Focus on decisions and dates.')
  } finally {
    host.restore()
  }
})

test('captureDreaming defaults to dynamic, can inherit, and an explicit value wins', () => {
  assert.equal(resolveSettings({}).captureDreaming, 'dynamic')
  assert.equal(resolveSettings({ captureDreaming: 'inherit' }).captureDreaming, 'instant')
  assert.equal(resolveSettings({ dreaming: 'dynamic', captureDreaming: 'inherit' }).captureDreaming, 'dynamic')
  assert.equal(resolveSettings({ dreaming: 'dynamic', captureDreaming: 'instant' }).captureDreaming, 'instant')
  assert.equal(resolveSettings({ captureDreaming: 'dynamic' }).dreaming, 'instant')
  assert.equal(resolveSettings({ captureDreaming: 'bogus' }).captureDreaming, 'dynamic')
  assert.equal(resolveSettings({ recallRerank: 'inherit', rerank: 'order' }).recallRerank, 'order')
  assert.equal(resolveSettings({ recallRerank: 'aggregate' }).recallRerank, 'aggregate')
  assert.equal(resolveSettings({}).recallIncludeRelated, false)
  assert.equal(resolveSettings({}).recallFailureNotice, true)
})

test('supermemory_save writes the given date and group', async () => {
  const writes = []
  const host = await createHost({
    config: { container: 'dsh' },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'dsh-1', status: 'queued' } }
      }
      return { body: { system: { status: 'done' } } }
    },
  })
  try {
    const tool = host.tools.get('supermemory_save')
    await tool.execute({
      content: 'Decision: the deploy window is Tuesday morning.',
      date: '2026-11-20',
      group: { project: 'acme', kind: 'decision' },
      title: 'Deploy window',
    }, { signal: new AbortController().signal })
    assert.equal(writes.length, 1)
    assert.equal(writes[0].date, '2026-11-20T00:00:00.000Z')
    assert.deepEqual(writes[0].group, { project: 'acme', kind: 'decision' })
    assert.equal(writes[0].taskType, 'memory')
    assert.equal(writes[0].dreaming, 'instant')
    assert.equal(writes[0].metadata.kind, 'decision')
    assert.equal(writes[0].metadata.project, 'acme')
  } finally {
    host.restore()
  }
})

test('an invalid date or group is rejected before any write', async () => {
  const host = await createHost({ config: { container: 'dsh' } })
  try {
    const tool = host.tools.get('supermemory_save')
    await assert.rejects(
      () => tool.execute({ content: 'some durable decision text', date: 'last tuesday' }, { signal: new AbortController().signal }),
      /ISO 8601/,
    )
    await assert.rejects(
      () => tool.execute({ content: 'some durable decision text', group: { bad: { nested: 1 } } }, { signal: new AbortController().signal }),
      /must be a string, number, boolean/,
    )
    assert.equal(host.calls.length, 0, `a rejected argument still made ${host.calls.length} request(s)`)
  } finally {
    host.restore()
  }
})

test('normalizeGroup accepts objects and JSON text and rejects unsafe shapes', () => {
  assert.deepEqual(normalizeGroup({ project: 'acme' }), { project: 'acme' })
  assert.deepEqual(normalizeGroup('{"project":"acme","kind":"decision"}'), { project: 'acme', kind: 'decision' })
  assert.deepEqual(normalizeGroup({ tags: ['a', 'b'] }), { tags: ['a', 'b'] })
  assert.equal(normalizeGroup('   '), undefined)
  assert.equal(normalizeGroup(undefined), undefined)
  assert.throws(() => normalizeGroup({ 'bad key': 'x' }), /invalid key/)
  assert.throws(() => normalizeGroup({ a: { nested: 1 } }), /must be a string, number, boolean/)
  assert.throws(() => normalizeGroup('{not json'), /expected a JSON object/)
  assert.throws(() => normalizeGroup([1, 2]), /expected an object/)
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, 'v']))
  assert.throws(() => normalizeGroup(many), /at most 20 keys/)
})

test('contextGroup uses the directory name only and always has a project', () => {
  assert.deepEqual(contextGroup('/Users/someone/private/secret-project'), { project: 'secret-project', kind: 'conversation' })
  assert.deepEqual(contextGroup('/x/y', 'file'), { project: 'y', kind: 'file' })
  assert.deepEqual(contextGroup(undefined), { project: 'workspace', kind: 'conversation' })
  assert.equal(contextGroup('/Users/someone/private/secret-project').project.includes('/'), false)
})
