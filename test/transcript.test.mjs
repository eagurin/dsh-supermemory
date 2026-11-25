import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscriptChunks, resolveSettings } from './helpers.mjs'
import { fakeSession, userMessage, assistantMessage } from './helpers.mjs'

test('the transcript keeps human turns and assistant answers only', () => {
  const session = fakeSession([
    userMessage('Привет, запомни это'),
    assistantMessage('Запомнил.'),
    userMessage('recall block', 'supermemory'),
  ], { cwd: '/workspace/demo' })
  const plan = buildTranscriptChunks(session, resolveSettings({ minCaptureChars: 10 }))
  const { turns } = plan
  const content = plan.documents[0]?.content ?? ''
  assert.equal(turns, 1)
  assert.match(content, /# DeepSeek Harness conversation session-test/)
  assert.match(content, /- workspace: \/workspace\/demo/)
  assert.match(content, /\*\*User:\*\* Привет, запомни это/)
  assert.match(content, /\*\*Assistant:\*\* Запомнил\./)
  assert.doesNotMatch(content, /recall block/)
})

test('a session shorter than minCaptureChars is not captured', () => {
  const session = fakeSession([userMessage('ок')])
  const plan = buildTranscriptChunks(session, resolveSettings({ minCaptureChars: 500 }))
  assert.deepEqual(plan.documents, [])
})

test('a long session is clamped from the tail and marked', () => {
  const messages = []
  for (let index = 0; index < 40; index += 1) {
    messages.push(userMessage(`вопрос номер ${index} ${'x'.repeat(120)}`))
    messages.push(assistantMessage(`ответ номер ${index} ${'y'.repeat(120)}`))
  }
  const plan = buildTranscriptChunks(fakeSession(messages), resolveSettings({ maxCaptureChars: 2000, captureTurnsPerChunk: 10, minCaptureChars: 10 }))
  assert.ok(plan.chunked, 'a session over the budget must be chunked')
  // A chunk keeps its beginning (the user's request) and marks what was dropped.
  const first = plan.documents[0].content
  assert.match(first, /\(part \d+\)/)
  assert.match(first, /вопрос номер 0/)
  assert.match(first, /later content omitted/)
})

test('a session without a usable message list does not throw', () => {
  const broken = { id: 'session-broken', header: {}, deriveMessages() { throw new Error('disposed') } }
  const plan = buildTranscriptChunks(broken, resolveSettings({}))
  assert.deepEqual(plan.documents, [])
  assert.equal(plan.turns, 0)
})

test('capture metadata counts the turns that were actually captured', () => {
  const session = fakeSession([userMessage('один'), assistantMessage('a'), userMessage('два')])
  const { turns } = buildTranscriptChunks(session, resolveSettings({ minCaptureChars: 5 }))
  assert.equal(turns, 2)
})
