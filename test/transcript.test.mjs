import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscript, resolveSettings } from './helpers.mjs'
import { fakeSession, userMessage, assistantMessage } from './helpers.mjs'

test('the transcript keeps human turns and assistant answers only', () => {
  const session = fakeSession([
    userMessage('Привет, запомни это'),
    assistantMessage('Запомнил.'),
    userMessage('recall block', 'supermemory'),
  ], { cwd: '/workspace/demo' })
  const { content, turns } = buildTranscript(session, resolveSettings({ minCaptureChars: 10 }))
  assert.equal(turns, 1)
  assert.match(content, /# DeepSeek Harness conversation session-test/)
  assert.match(content, /- workspace: \/workspace\/demo/)
  assert.match(content, /\*\*User:\*\* Привет, запомни это/)
  assert.match(content, /\*\*Assistant:\*\* Запомнил\./)
  assert.doesNotMatch(content, /recall block/)
})

test('a session shorter than minCaptureChars is not captured', () => {
  const session = fakeSession([userMessage('ок')])
  const { content } = buildTranscript(session, resolveSettings({ minCaptureChars: 500 }))
  assert.equal(content, '')
})

test('a long session is clamped from the tail and marked', () => {
  const messages = []
  for (let index = 0; index < 40; index += 1) {
    messages.push(userMessage(`вопрос номер ${index} ${'x'.repeat(120)}`))
    messages.push(assistantMessage(`ответ номер ${index} ${'y'.repeat(120)}`))
  }
  const { content } = buildTranscript(fakeSession(messages), resolveSettings({ maxCaptureChars: 2000 }))
  assert.match(content, /…\[earlier turns omitted\]/)
  assert.ok(content.length < 4000)
  assert.match(content, /ответ номер 39/)
})

test('a session without a usable message list does not throw', () => {
  const broken = { id: 'session-broken', header: {}, deriveMessages() { throw new Error('disposed') } }
  const { content, turns } = buildTranscript(broken, resolveSettings({}))
  assert.equal(content, '')
  assert.equal(turns, 0)
})

test('capture metadata counts the turns that were actually captured', () => {
  const session = fakeSession([userMessage('один'), assistantMessage('a'), userMessage('два')])
  const { turns } = buildTranscript(session, resolveSettings({}))
  assert.equal(turns, 2)
})
