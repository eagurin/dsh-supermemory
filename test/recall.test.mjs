import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, hook } from './host.mjs'

const userTurn = (text, kind = 'user') => ({ role: 'user', content: [{ type: 'text', text }], source: { kind } })

/** Drive the recall hook with one decision and return the injected block, if any. */
async function runPreStep(host, options = {}) {
  const preStep = hook(host, 'agent/pre-step')
  const human = options.message ?? userTurn(options.text ?? 'what did we decide about deploys?')
  const decision = { kind: 'enter', messages: [human] }
  const signal = options.signal ?? new AbortController().signal
  const result = await preStep.handler(
    {
      agent: { id: options.sessionId ?? 'sess-recall', session: { header: options.header ?? {} } },
      messages: decision.messages,
      turn: options.turn ?? 1,
      step: 1,
      signal,
    },
    async () => decision,
  )
  const injected = result.messages.find(message => message.source && message.source.kind === 'supermemory')
  return { result, injected, text: injected ? injected.content[0].text : '' }
}

/** A fetch stub that never answers but rejects on abort, like a real request behind a timeout. */
const hangingFetch = (url, init = {}) => new Promise((_, reject) => {
  if (!init.signal) return
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
})

test('a recall that times out leaves a visible notice instead of failing silently', async () => {
  const host = await createHost({
    config: { profileFrequency: 0, recallTimeoutMs: 250 },
    fetchHandler: hangingFetch,
  })
  try {
    const { text } = await runPreStep(host)
    assert.match(text, /memory recall unavailable \(timeout\) — proceed without memory/)
    const open = text.match(/<<<supermemory-([0-9a-f-]{36})>>>/)
    assert.ok(open, 'the notice is not inside a delimited block')
    assert.ok(text.includes(`<<<end-supermemory-${open[1]}>>>`), 'the block has no closer')
  } finally {
    host.restore()
  }
})

test('a partial recall failure still shows the facts it did get and marks the loss', async () => {
  const host = await createHost({
    config: { profileFrequency: 0, readContainers: ['hermes_default'] },
    fetchHandler: url => {
      if (url.includes('/ns/dsh/search')) {
        return { body: { results: [{ memory: 'the deploy window is Tuesday morning', similarity: 0.9 }] } }
      }
      if (url.includes('/ns/hermes_default/search')) return { status: 500, body: { error: 'boom' } }
      return { body: {} }
    },
  })
  try {
    const { text } = await runPreStep(host)
    assert.match(text, /the deploy window is Tuesday morning/)
    assert.match(text, /memory recall incomplete \(error\) — some namespaces were not searched/)
  } finally {
    host.restore()
  }
})

test('recallFailureNotice false keeps the old silent degradation', async () => {
  const host = await createHost({
    config: { profileFrequency: 0, recallFailureNotice: false },
    fetchHandler: () => ({ status: 500, body: { error: 'boom' } }),
  })
  try {
    const { result, injected } = await runPreStep(host)
    assert.equal(injected, undefined, 'a notice block was injected although the notice is off')
    assert.equal(result.messages.length, 1)
  } finally {
    host.restore()
  }
})

test('recall asks for relations only when enabled and renders one compact relation line', async () => {
  const host = await createHost({
    config: { profileFrequency: 0, recallIncludeRelated: true },
    fetchHandler: url => (url.includes('/search') ? {
      body: { results: [{
        id: 'mem-1',
        memory: 'the current deploy policy is Tuesday only',
        similarity: 0.9,
        system: { updatedAt: '2026-11-20T00:00:00Z' },
        included: { related: { parents: [{ id: 'mem-0', relation: 'updates', version: 1, memory: 'deploys used to be any day', metadata: {}, system: { updatedAt: '2026-10-01T00:00:00Z' } }], children: [], siblings: [] } },
      }] },
    } : { body: {} }),
  })
  try {
    const { text } = await runPreStep(host)
    const body = JSON.parse(String(host.calls.find(call => call.url.includes('/search')).body))
    assert.equal(body.include.related, true)
    assert.match(text, /2026-11-20/)
    assert.match(text, /↳ updates v1 \(earlier, 2026-10-01\): deploys used to be any day/)
  } finally {
    host.restore()
  }
})

test('recall does not ask for relations by default', async () => {
  const host = await createHost({
    config: { profileFrequency: 0 },
    fetchHandler: url => (url.includes('/search') ? { body: { results: [{ memory: 'a plain recalled fact about deploys', similarity: 0.9 }] } } : { body: {} }),
  })
  try {
    await runPreStep(host)
    const body = JSON.parse(String(host.calls.find(call => call.url.includes('/search')).body))
    assert.deepEqual(body.include, { documents: false, related: false })
  } finally {
    host.restore()
  }
})

test('a long profile cannot crowd the query-specific facts out of the recall block', async () => {
  const profile = {
    profile: {
      static: Array.from({ length: 40 }, (_, index) => ({ id: `p-${index}`, memory: `profile fact ${index} ${'p'.repeat(180)}` })),
      dynamic: [],
      buckets: {},
    },
  }
  const host = await createHost({
    config: { profileFrequency: 1, recallMaxChars: 3000, profileMaxChars: 1800 },
    fetchHandler: url => {
      if (url.includes('/profile')) return { body: profile }
      if (url.includes('/search')) return { body: { results: [{ memory: 'the query-specific decision is a Tuesday deploy window', similarity: 0.95 }] } }
      return { body: {} }
    },
  })
  try {
    const { text } = await runPreStep(host)
    assert.match(text, /Known profile facts:/)
    assert.match(text, /query-specific decision is a Tuesday deploy window/, 'the profile evicted the answer to the question')
    assert.ok(text.length <= 3000 + 60, `the block ignored its budget: ${text.length}`)
  } finally {
    host.restore()
  }
})

test('scheduled and team turns still get recall', async () => {
  for (const kind of ['schedule', 'team-message']) {
    const host = await createHost({
      config: { profileFrequency: 0 },
      fetchHandler: url => (url.includes('/search') ? { body: { results: [{ memory: 'a standing fact about this project', similarity: 0.9 }] } } : { body: {} }),
    })
    try {
      const { text } = await runPreStep(host, { message: userTurn('scheduled job body', kind) })
      assert.match(text, /a standing fact about this project/, `${kind} turns lost recall`)
    } finally {
      host.restore()
    }
  }
})

test('an aborted turn makes no recall request at all', async () => {
  const host = await createHost({ config: { profileFrequency: 0 } })
  try {
    const controller = new AbortController()
    controller.abort()
    const { injected } = await runPreStep(host, { signal: controller.signal })
    assert.equal(injected, undefined)
    assert.equal(host.calls.length, 0, `an aborted turn made ${host.calls.length} request(s)`)
  } finally {
    host.restore()
  }
})
