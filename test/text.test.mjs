import test from 'node:test'
import assert from 'node:assert/strict'
import { clampLines, resultText, profileFacts, mergeFacts, messageText, lastUserMessage } from './helpers.mjs'
import { userMessage, assistantMessage } from './helpers.mjs'

test('clampLines keeps the head by default', () => {
  const out = clampLines(['one', 'two', 'three'], 9)
  assert.equal(out, 'one\ntwo')
})

test('clampLines keeps the tail when asked', () => {
  // The tail survives, but in chronological order: only the head is dropped.
  const out = clampLines(['one', 'two', 'three'], 12, 'tail')
  assert.equal(out, 'two\nthree')
})

test('clampLines never returns an empty string', () => {
  assert.equal(clampLines(['a very long single line'], 5), 'a ver')
  assert.equal(clampLines(['a very long single line'], 40), 'a very long single line')
  const clamped = clampLines(['x'.repeat(100)], 30)
  assert.equal(clamped.length, 30)
  assert.ok(clamped.endsWith('…[truncated]'))
})

test('resultText normalizes whitespace and accepts every field name', () => {
  assert.equal(resultText({ memory: '  a   b  ' }), 'a b')
  assert.equal(resultText({ chunk: 'c' }), 'c')
  assert.equal(resultText({ content: 'd' }), 'd')
  assert.equal(resultText({ text: 'e' }), 'e')
  assert.equal(resultText({}), '')
  assert.equal(resultText(null), '')
  assert.equal(resultText({ memory: 42 }), '')
})

test('profileFacts reads static and dynamic buckets', () => {
  const facts = profileFacts({
    profile: { static: ['a', { memory: 'b' }], dynamic: ['c'] },
  })
  assert.deepEqual(facts, ['a', 'b', 'c'])
  assert.deepEqual(profileFacts({}), [])
  assert.deepEqual(profileFacts(null), [])
})

test('mergeFacts drops duplicates, sorts by similarity, and honors the limit', () => {
  const groups = [
    { container: 'dsh', results: [
      { memory: 'first fact with enough length', similarity: 0.2 },
      { memory: 'second fact with enough length', similarity: 0.9 },
      { memory: 'second fact with enough length', similarity: 0.5 },
    ] },
    { container: 'hermes_default', results: [
      { memory: 'third fact with enough length', similarity: 0.7, id: 'mem-3' },
    ] },
  ]
  const facts = mergeFacts(groups, 2)
  assert.equal(facts.length, 2)
  assert.equal(facts[0].text, 'second fact with enough length')
  assert.equal(facts[1].container, 'hermes_default')
  assert.equal(facts[1].memoryId, 'mem-3')
})

test('mergeFacts skips text that is too short to be a fact', () => {
  const facts = mergeFacts([{ container: 'dsh', results: [{ memory: 'short', similarity: 1 }] }], 5)
  assert.deepEqual(facts, [])
})

test('messageText joins text blocks and ignores other content', () => {
  assert.equal(messageText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(messageText({ content: 'plain string' }), '')
  assert.equal(messageText(null), '')
})

test('lastUserMessage accepts human and scheduled turns but not the recall block', () => {
  const messages = [
    userMessage('first'),
    assistantMessage('answer'),
    userMessage('system recall', 'supermemory'),
    userMessage('second'),
  ]
  assert.deepEqual(lastUserMessage(messages), { text: 'second', index: 3 })
  assert.deepEqual(lastUserMessage([assistantMessage('only answer')]), { text: '', index: -1 })
  const scheduled = { role: 'user', content: [{ type: 'text', text: 'scheduled job body' }], source: { kind: 'schedule' } }
  assert.deepEqual(lastUserMessage([scheduled]), { text: 'scheduled job body', index: 0 })
  const recall = { role: 'user', content: [{ type: 'text', text: 'recalled background' }], source: { kind: 'supermemory', form: 'recall' } }
  assert.deepEqual(lastUserMessage([recall]), { text: '', index: -1 })
})
