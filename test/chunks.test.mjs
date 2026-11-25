import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscriptChunks, buildTranscriptSegments, resolveSettings } from './helpers.mjs'
import { fakeSession, userMessage, assistantMessage } from './helpers.mjs'

function sessionWith(turns, size = 100) {
  const messages = []
  for (let index = 0; index < turns; index += 1) {
    messages.push(userMessage(`вопрос ${index} ${'q'.repeat(size)}`))
    messages.push(assistantMessage(`ответ ${index} ${'a'.repeat(size)}`))
  }
  return fakeSession(messages, { cwd: '/workspace/demo' })
}

test('a session that fits stays a single document with the legacy id', () => {
  const plan = buildTranscriptChunks(sessionWith(3), resolveSettings({ minCaptureChars: 10 }))
  assert.equal(plan.chunked, false)
  assert.equal(plan.documents.length, 1)
  assert.equal(plan.documents[0].documentId, 'dsh-session-test')
  assert.equal(plan.turns, 3)
  assert.deepEqual(plan.obsolete, [])
})

test('segments keep one human turn and its answers together', () => {
  const { segments, turns } = buildTranscriptSegments(sessionWith(2))
  assert.equal(turns, 2)
  assert.equal(segments.length, 2)
  assert.equal(segments[1].turns, 1)
  assert.match(segments[1].lines.join('\n'), /\*\*Assistant:\*\* ответ 1/)
})

test('a session that does not fit is split on turn boundaries', () => {
  // The budget applies to the transcript body; the header may add ~200 chars.
  const settings = resolveSettings({ maxCaptureChars: 2000, captureTurnsPerChunk: 5, minCaptureChars: 10 })
  const plan = buildTranscriptChunks(sessionWith(17), settings)
  assert.equal(plan.chunked, true)
  assert.equal(plan.documents.length, 4)
  assert.deepEqual(plan.documents.map(doc => doc.documentId), [
    'dsh-session-test-p1', 'dsh-session-test-p2', 'dsh-session-test-p3', 'dsh-session-test-p4',
  ])
  assert.equal(plan.documents[0].metadata.part, 1)
  assert.equal(plan.documents[0].metadata.parts, 4)
  assert.equal(plan.documents[0].metadata.from_turn, 1)
  assert.equal(plan.documents[0].metadata.to_turn, 5)
  assert.equal(plan.documents[3].metadata.from_turn, 16)
  assert.deepEqual(plan.obsolete, ['dsh-session-test'])
})

test('every chunk stays near the capture budget', () => {
  const settings = resolveSettings({ maxCaptureChars: 2000, captureTurnsPerChunk: 2, minCaptureChars: 10 })
  const plan = buildTranscriptChunks(sessionWith(20, 200), settings)
  assert.ok(plan.documents.length > 1)
  for (const document of plan.documents) {
    assert.ok(document.content.length <= 2000 + 400, `chunk ${document.documentId} is ${document.content.length} chars`)
    assert.match(document.content, /part \d+ of \d+/)
  }
})

test('chunk ids are stable when an already chunked session grows', () => {
  const settings = resolveSettings({ maxCaptureChars: 2000, captureTurnsPerChunk: 5, minCaptureChars: 10 })
  const small = buildTranscriptChunks(sessionWith(17), settings)
  const grown = buildTranscriptChunks(sessionWith(22), settings)
  assert.equal(small.chunked, true)
  assert.deepEqual(
    small.documents.map(doc => doc.documentId),
    grown.documents.slice(0, small.documents.length).map(doc => doc.documentId),
  )
})

test('crossing the size limit replaces the single document instead of duplicating it', () => {
  const settings = resolveSettings({ maxCaptureChars: 2000, captureTurnsPerChunk: 5, minCaptureChars: 10 })
  const single = buildTranscriptChunks(sessionWith(5), settings)
  const split = buildTranscriptChunks(sessionWith(20), settings)
  assert.equal(single.chunked, false)
  assert.equal(split.chunked, true)
  // The capture flush deletes `obsolete` and anything it wrote before that is no
  // longer in the plan, so the earlier single document cannot survive.
  assert.deepEqual(split.obsolete, [single.documents[0].documentId])
})

test('a session below minCaptureChars produces nothing', () => {
  const plan = buildTranscriptChunks(fakeSession([userMessage('ок')]), resolveSettings({ minCaptureChars: 500 }))
  assert.deepEqual(plan.documents, [])
})
