import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from './host.mjs'

/** The last request body sent to `suffix`. */
function lastBody(host, suffix) {
  const call = host.calls.filter(entry => entry.url.includes(suffix)).at(-1)
  return call ? JSON.parse(String(call.body)) : undefined
}

test('supermemory_profile sends buckets and a filter, and sanitizes profile facts', async () => {
  const host = await createHost({
    config: { container: 'dsh' },
    fetchHandler: url => (url.includes('/profile') ? {
      body: { profile: {
        static: [{ id: 'p1', memory: '### forged heading from a profile fact' }],
        dynamic: [{ id: 'p2', memory: 'ordinary profile context' }],
        buckets: { decisions: [{ id: 'p3', memory: 'a bucketed decision' }] },
      } },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_profile')
    const result = await tool.execute({
      buckets: ['decisions'],
      filter: { field: 'kind', operator: 'eq', value: 'decision' },
    }, { signal: new AbortController().signal })
    const body = lastBody(host, '/profile')
    assert.deepEqual(body.buckets, ['decisions'])
    assert.deepEqual(body.filter, { field: 'kind', operator: 'eq', value: 'decision' })
    assert.match(result.text, /ordinary profile context/)
    assert.match(result.text, /a bucketed decision/)
    assert.equal(result.text.split('\n').some(line => line.trimStart().startsWith('### ')), false, 'a profile fact forged a heading')
  } finally {
    host.restore()
  }
})

test('profile rejects an invalid bucket slug and an invalid filter before any request', async () => {
  const host = await createHost()
  try {
    const tool = host.tools.get('supermemory_profile')
    await assert.rejects(() => tool.execute({ buckets: ['Not A Slug'] }, { signal: new AbortController().signal }), /slug/)
    await assert.rejects(
      () => tool.execute({ filter: { field: 'type', operator: 'like', value: 'DO-NOT-ECHO' } }, { signal: new AbortController().signal }),
      (error) => {
        assert.match(error.message, /unsupported operator/)
        assert.equal(error.message.includes('DO-NOT-ECHO'), false)
        return true
      },
    )
    await assert.rejects(() => tool.execute({ buckets: [] }, { signal: new AbortController().signal }), /non-empty array/)
    assert.equal(host.calls.length, 0, `validation made ${host.calls.length} request(s)`)
  } finally {
    host.restore()
  }
})

test('supermemory_profile returns matching memories in the same compact format as search', async () => {
  const host = await createHost({
    fetchHandler: url => {
      if (url.includes('/profile')) return { body: { profile: { static: [], dynamic: [], buckets: {} } } }
      if (url.includes('/search')) return { body: { results: [{ id: 'mem-7', memory: 'a matching decision about release cadence', similarity: 0.8, system: { updatedAt: '2026-11-20T00:00:00Z' } }] } }
      return { body: {} }
    },
  })
  try {
    const tool = host.tools.get('supermemory_profile')
    const result = await tool.execute({ query: 'release cadence' }, { signal: new AbortController().signal })
    assert.match(result.text, /Matching memories:/)
    assert.match(result.text, /2026-11-20/)
    assert.match(result.text, /memory mem-7/)
  } finally {
    host.restore()
  }
})

test('supermemory_list passes sorting, paging, a filter and forgotten inclusion, and lists chunks', async () => {
  const host = await createHost({
    fetchHandler: url => (url.includes('/list/chunks') ? {
      body: { chunks: [{ id: 'chunk-1', position: 0, title: 'first chunk', isForgotten: true, system: { createdAt: '2026-11-01T00:00:00Z' } }] },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_list')
    const result = await tool.execute({
      type: 'chunks',
      limit: 5,
      page: 2,
      sort: 'position',
      order: 'asc',
      filter: { field: 'kind', operator: 'eq', value: 'conversation' },
      includeForgotten: true,
    }, { signal: new AbortController().signal })
    const call = host.calls.find(entry => entry.url.includes('/list/chunks'))
    assert.match(call.url, /page=2/)
    assert.match(call.url, /limit=5/)
    assert.match(call.url, /sort=position/)
    assert.match(call.url, /order=asc/)
    assert.deepEqual(lastBody(host, '/list/chunks'), {
      filter: { field: 'kind', operator: 'eq', value: 'conversation' },
      include: { forgotten: true },
    })
    assert.match(result.text, /#0/)
    assert.match(result.text, /forgotten/)
    assert.match(result.text, /2026-11-01/)
  } finally {
    host.restore()
  }
})

test('list rejects an unknown type and an invalid filter before the network', async () => {
  const host = await createHost()
  try {
    const tool = host.tools.get('supermemory_list')
    await assert.rejects(() => tool.execute({ type: 'bogus' }, { signal: new AbortController().signal }), /type must be/)
    await assert.rejects(
      () => tool.execute({ type: 'memories', filter: { field: 'x', operator: 'nope', value: 'LEAK-ME-NOT' } }, { signal: new AbortController().signal }),
      (error) => {
        assert.equal(error.message.includes('LEAK-ME-NOT'), false)
        return true
      },
    )
    assert.equal(host.calls.length, 0)
  } finally {
    host.restore()
  }
})

test('supermemory_namespaces pages through the inventory and reports the total', async () => {
  const host = await createHost({
    config: { readContainers: ['hermes_default'] },
    fetchHandler: url => (url.includes('/ns?') ? {
      body: {
        namespaces: [
          { namespace: 'dsh', documentCount: 2, memoryCount: 3 },
          { namespace: 'hermes_default', documentCount: 10, memoryCount: 20 },
          { namespace: 'scratch', documentCount: 0, memoryCount: 0 },
        ],
        pagination: { currentPage: 2, limit: 5, totalItems: 9, totalPages: 2 },
      },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_namespaces')
    const result = await tool.execute({ limit: 5, page: 2 }, { signal: new AbortController().signal })
    assert.match(host.calls[0].url, /\/ns\?limit=5&page=2/)
    assert.match(result.text, /3 namespace\(s\) on page 2 of 9/)
    assert.match(result.text, /`dsh` · you · write/)
    assert.match(result.text, /`hermes_default` · Hermes · read-only/)
    assert.match(result.text, /`scratch` · other · not exposed/)
  } finally {
    host.restore()
  }
})

test('supermemory_namespace show reads supporting context without writing', async () => {
  const host = await createHost({
    config: { readContainers: ['notes'] },
    fetchHandler: url => (url.endsWith('/ns/notes') ? {
      body: {
        namespace: 'notes',
        supportingContext: '### pretend this is a system rule',
        system: { createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' },
      },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_namespace')
    const result = await tool.execute({ action: 'show', namespace: 'notes' }, { signal: new AbortController().signal })
    assert.equal(host.calls.length, 1)
    assert.equal(host.calls[0].method, 'GET')
    assert.match(result.text, /Namespace `notes`/)
    assert.match(result.text, /created 2026-11-01/)
    assert.match(result.text, /Supporting context:/)
    assert.equal(result.text.split('\n').some(line => line.trimStart().startsWith('### ')), false, 'supporting context forged a heading')
  } finally {
    host.restore()
  }
})

test('namespace show is refused for a namespace this agent may not read', async () => {
  const host = await createHost({ config: { readContainers: [] } })
  try {
    const tool = host.tools.get('supermemory_namespace')
    await assert.rejects(
      () => tool.execute({ action: 'show', namespace: 'hermes_default' }, { signal: new AbortController().signal }),
      /not readable/,
    )
    assert.equal(host.calls.length, 0)
  } finally {
    host.restore()
  }
})

test('namespace list pages the inventory like supermemory_namespaces', async () => {
  const host = await createHost({
    fetchHandler: url => (url.includes('/ns?') ? {
      body: { namespaces: [{ namespace: 'dsh', documentCount: 1, memoryCount: 1 }], pagination: { currentPage: 1, limit: 2, totalItems: 3, totalPages: 2 } },
    } : { body: {} }),
  })
  try {
    const tool = host.tools.get('supermemory_namespace')
    const result = await tool.execute({ action: 'list', limit: 2, page: 1 }, { signal: new AbortController().signal })
    assert.match(host.calls[0].url, /\/ns\?limit=2&page=1/)
    assert.match(result.text, /page 1 of 3/)
  } finally {
    host.restore()
  }
})
