import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeContainer, isHermesContainer, containerLabel } from './helpers.mjs'

test('sanitizeContainer keeps allowed characters and falls back to dsh', () => {
  assert.equal(sanitizeContainer('hermes_default'), 'hermes_default')
  assert.equal(sanitizeContainer('a-b:c'), 'a-b:c')
  assert.equal(sanitizeContainer('hermes-omh'), 'hermes-omh')
  assert.equal(sanitizeContainer('with space'), 'with_space')
  assert.equal(sanitizeContainer('   '), 'dsh')
})

test('isHermesContainer covers both separators', () => {
  assert.equal(isHermesContainer('hermes'), true)
  assert.equal(isHermesContainer('hermes_default'), true)
  assert.equal(isHermesContainer('hermes-omh'), true)
  assert.equal(isHermesContainer('dsh'), false)
  assert.equal(isHermesContainer('hermesx'), false)
})

test('labels name the agent, never the current one as Hermes', () => {
  assert.match(containerLabel('dsh', 'dsh'), /Your memory/)
  assert.match(containerLabel('hermes_default', 'dsh'), /Agent Hermes, default profile/)
  assert.match(containerLabel('hermes_omh_tui', 'dsh'), /another agent/)
  assert.match(containerLabel('omo_native', 'dsh'), /Container `omo_native`/)
})
