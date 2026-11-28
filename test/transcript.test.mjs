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
  assert.equal(content.includes('/workspace/demo'), false, 'the absolute workspace path reached the document')
  assert.match(content, /\*\*User:\*\* Привет, запомни это/)
  assert.match(content, /\*\*Assistant:\*\* Запомнил\./)
  assert.doesNotMatch(content, /recall block/)
})

test('a session shorter than minCaptureChars is not captured', () => {
  const session = fakeSession([userMessage('ок')])
  const plan = buildTranscriptChunks(session, resolveSettings({ minCaptureChars: 500 }))
  assert.deepEqual(plan.documents, [])
})

test('a long session is split into parts instead of clamped at the tail', () => {
  const messages = []
  for (let index = 0; index < 40; index += 1) {
    messages.push(userMessage(`вопрос номер ${index} ${'x'.repeat(120)}`))
    messages.push(assistantMessage(`ответ номер ${index} ${'y'.repeat(120)}`))
  }
  const plan = buildTranscriptChunks(fakeSession(messages), resolveSettings({ maxCaptureChars: 2000, captureTurnsPerChunk: 10, minCaptureChars: 10 }))
  assert.ok(plan.chunked, 'a session over the budget must be chunked')
  // Split on turn boundaries instead of dropping the tail: every part starts at its
  // own turn and no part needs the omission marker.
  const first = plan.documents[0].content
  assert.match(first, /\(part \d+\)/)
  assert.match(first, /вопрос номер 0/)
  assert.equal(first.includes('later content omitted'), false)
  const joined = plan.documents.map(document => document.content).join('\n')
  assert.match(joined, /вопрос номер 39/, 'the final human turn must be preserved')
  for (const document of plan.documents) {
    assert.ok(document.content.length <= 2000 + 400, `part ${document.documentId} is ${document.content.length} chars`)
    assert.equal(document.metadata.part >= 1, true)
    assert.equal(document.metadata.parts, plan.documents.length)
  }
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
