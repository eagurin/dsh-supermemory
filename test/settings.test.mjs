import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings, DEFAULTS, CONFIG_KEYS } from './helpers.mjs'

test('defaults are complete and stable', () => {
  const settings = resolveSettings({})
  assert.equal(settings.container, 'dsh')
  assert.equal(settings.baseUrl, 'http://127.0.0.1:8787')
  assert.deepEqual(settings.readContainers, [])
  assert.equal(settings.filter, undefined)
  assert.equal(settings.rewriteQuery, false)
  assert.equal(settings.ingestWaitMs, 1500)
  assert.equal(Object.keys(DEFAULTS).length, CONFIG_KEYS.length)
})

test('an unknown key fails loudly instead of being ignored', () => {
  assert.throws(() => resolveSettings({ threshod: 0.5 }), /unknown configuration key\(s\): threshod/)
  assert.throws(() => resolveSettings({ container: 'x', bogus: 1 }), /bogus/)
})

test('numbers are clamped into their documented range', () => {
  assert.equal(resolveSettings({ maxRecallResults: 999 }).maxRecallResults, 20)
  assert.equal(resolveSettings({ maxRecallResults: -5 }).maxRecallResults, 1)
  assert.equal(resolveSettings({ threshold: 5 }).threshold, 1)
  assert.equal(resolveSettings({ recallTimeoutMs: 1 }).recallTimeoutMs, 250)
  assert.equal(resolveSettings({ ingestWaitMs: 999999 }).ingestWaitMs, 30000)
})

test('enums fall back to the default instead of accepting garbage', () => {
  assert.equal(resolveSettings({ searchMode: 'bogus' }).searchMode, 'hybrid')
  assert.equal(resolveSettings({ rerank: 'bogus' }).rerank, 'none')
  assert.equal(resolveSettings({ dreaming: 'dynamic' }).dreaming, 'dynamic')
})

test('containers are sanitized to names the API accepts', () => {
  const settings = resolveSettings({ container: 'my agent!', readContainers: ['hermes_default', 'bad name'] })
  assert.equal(settings.container, 'my_agent_')
  assert.deepEqual(settings.readContainers, ['hermes_default', 'bad_name'])
})

test('baseUrl loses trailing slashes and keeps the path', () => {
  assert.equal(resolveSettings({ baseUrl: 'https://api.supermemory.ai///' }).baseUrl, 'https://api.supermemory.ai')
  assert.equal(resolveSettings({ baseUrl: 'http://127.0.0.1:6767/api/' }).baseUrl, 'http://127.0.0.1:6767/api')
})

test('a filter may be given as an object or as JSON text', () => {
  const asObject = resolveSettings({ filter: { field: 'type', operator: 'neq', value: 'conversation' } })
  const asText = resolveSettings({ filter: '{"field":"type","operator":"neq","value":"conversation"}' })
  assert.deepEqual(asObject.filter, asText.filter)
  assert.equal(resolveSettings({ filter: '   ' }).filter, undefined)
})
