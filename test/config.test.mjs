import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../index.js'

// The schema is only available when `@deepseek-ai/schemastery` is installed
// (a git install brings it; a plain directory link does not).
const maybe = Config === undefined ? test.skip : test

maybe('the schema accepts the configuration that runs on this machine', () => {
  const live = {
    baseUrl: 'http://localhost:6767',
    container: 'dsh',
    readContainers: ['hermes_default'],
    readPrefixes: ['hermes'],
    autoRecall: true,
    autoCapture: true,
    searchMode: 'hybrid',
    maxRecallResults: 6,
    profileFrequency: 20,
    dreaming: 'instant',
  }
  const resolved = Config(live)
  assert.equal(resolved.container, 'dsh')
  assert.equal(resolved.filter, '')
  assert.equal(resolved.rewriteQuery, false)
  assert.equal(resolved.ingestWaitMs, 1500)
})

maybe('the schema fills every default', () => {
  const resolved = Config({})
  assert.equal(resolved.baseUrl, 'http://127.0.0.1:6767')
  assert.deepEqual(resolved.readContainers, [])
  assert.equal(resolved.threshold, 0.3)
  assert.equal(resolved.maxCaptureChars, 120000)
  assert.equal(resolved.timeoutMs, 120000)
  assert.equal(resolved.recallTimeoutMs, 30000)
})

maybe('the schema rejects a wrong type and a wrong enum value', () => {
  assert.throws(() => Config({ maxRecallResults: 'many' }), /expected number/)
  assert.throws(() => Config({ searchMode: 'fuzzy' }), /expected "hybrid"/)
})
