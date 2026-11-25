import { internals } from '../index.js'

export const { resolveSettings, normalizeFilter, sanitizeContainer, isHermesContainer, containerLabel, mergeFacts, resultText, profileFacts, clampLines, messageText, lastUserMessage, buildTranscript, ingestText, writableContainers, DEFAULTS, CONFIG_KEYS } = internals

/** A message as the session stores it. */
export function userMessage(text, kind = 'user') {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind } }
}

export function assistantMessage(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

/** Minimal Session stand-in: only `id`, `header`, and `deriveMessages()`. */
export function fakeSession(messages, header = {}) {
  return { id: 'session-test', header, deriveMessages: () => messages }
}
