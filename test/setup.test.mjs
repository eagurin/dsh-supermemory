import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPlan } from '../scripts/setup.mjs'
import { DEFAULTS } from './helpers.mjs'

test('a reachable local server becomes the plan with no server warning', () => {
  const plan = buildPlan({ mode: 'local', localUp: true, localUrl: 'http://127.0.0.1:6767' })
  assert.equal(plan.mode, 'local')
  assert.equal(plan.baseUrl, 'http://127.0.0.1:6767')
  assert.equal(plan.localServerDetected, true)
  assert.equal(plan.warnings.some(warning => warning.includes('npx supermemory local')), false)
})

test('a missing local server is reported, not hidden', () => {
  const plan = buildPlan({ mode: 'local', localUp: false, localUrl: 'http://127.0.0.1:6767' })
  assert.equal(plan.localServerDetected, false)
  assert.match(plan.warnings.join('\n'), /npx supermemory local/)
})

test('the cloud plan warns that transcripts leave the machine', () => {
  const plan = buildPlan({ mode: 'cloud', localUp: true })
  assert.equal(plan.baseUrl, 'https://api.supermemory.ai')
  assert.match(plan.warnings.join('\n'), /leave this machine/)
})

test('the plan always explains that an override replaces the whole config', () => {
  for (const mode of ['local', 'cloud']) {
    const plan = buildPlan({ mode, localUp: true })
    assert.match(plan.warnings.at(-1), /replaces the whole config/)
  }
})

test('the rendered row carries every default, so pasting it cannot lose one', () => {
  const plan = buildPlan({ mode: 'local', localUp: true })
  for (const key of Object.keys(DEFAULTS)) {
    assert.ok(plan.row.includes(`    ${key}:`) || plan.row.includes(`    ${key}: `), `row is missing ${key}`)
  }
  assert.match(plan.row, /- id: supermemory/)
  assert.match(plan.row, /name: '@local\/dsh-supermemory'/)
})

test('custom choices are applied and sanitized', () => {
  const plan = buildPlan({ mode: 'cloud', keyRef: 'MY_KEY', container: 'my agent', readContainers: ['hermes_default', 'bad name'] })
  assert.equal(plan.apiKeyRef, 'MY_KEY')
  assert.equal(plan.container, 'my_agent')
  assert.deepEqual(plan.readContainers, ['hermes_default', 'bad_name'])
})

test('a bad mode or a non-URL is rejected', () => {
  assert.throws(() => buildPlan({ mode: 'sneaky' }), /mode must be "local" or "cloud"/)
  assert.throws(() => buildPlan({ mode: 'local', baseUrl: 'not-a-url' }), /not an http\(s\) URL/)
  assert.throws(() => buildPlan({ mode: 'cloud', baseUrl: 'ftp://example.com' }), /not an http\(s\) URL/)
})
