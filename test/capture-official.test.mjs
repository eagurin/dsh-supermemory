import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost, hook } from './host.mjs'
import { internals } from '../index.js'

const {
  resolveSettings, buildTranscriptChunks, projectIdentity, normalizeGitRemote,
  stripPrivate, isFullyPrivate, stripDataUris, redactSecrets,
} = internals

function session(id, messages, header = { cwd: '/Users/someone/private/secret-project' }) {
  return { id, header, deriveMessages: () => messages }
}

function userTurn(text) {
  return { id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function answer(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

test('capture includes tool calls and results, names the tool, marks errors and skips memory tools', () => {
  const messages = [
    userTurn('please fix the deploy bug'),
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'Error: deploy failed because migration needs --force' }] },
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c2', name: 'supermemory_search', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c2', content: [{ type: 'text', text: 'a recalled fact that must not loop back into memory' }] },
  ]
  const plan = buildTranscriptChunks(session('session-tools', messages), resolveSettings({ minCaptureChars: 5 }))
  const content = plan.documents[0].content
  assert.match(content, /\*\*Tool bash \(error\):\*\* Error: deploy failed because migration needs --force/)
  assert.equal(content.includes('must not loop back into memory'), false, 'the plugin captured its own memory tool output')
  assert.match(content, /\*\*User:\*\* please fix the deploy bug/)
})

test('captureTools false leaves tool traffic out, and captureToolChars bounds it', () => {
  const messages = [
    userTurn('check the deploy'),
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(5000) }] },
  ]
  const off = buildTranscriptChunks(session('session-tools-off', messages), resolveSettings({ minCaptureChars: 5, captureTools: false }))
  assert.equal(off.documents[0].content.includes('**Tool bash:**'), false)
  const capped = buildTranscriptChunks(session('session-tools-cap', messages), resolveSettings({ minCaptureChars: 5, captureToolChars: 120 }))
  const line = capped.documents[0].content.split('\n').find(entry => entry.startsWith('**Tool bash:**'))
  assert.ok(line, 'the capped tool line is missing')
  assert.ok(line.length < 200, `the tool line was not capped: ${line.length}`)
})

test('a fully private turn is dropped with its answer, while a partial private block is redacted', () => {
  const messages = [
    { ...userTurn('<private>my bank password is hunter2 and my address</private>'), id: 'p1' },
    answer('understood, that stays private'),
    userTurn('the deploy window is Tuesday <private>and the internal host is db-prod-42</private>'),
    answer('noted the Tuesday window'),
  ]
  const plan = buildTranscriptChunks(session('session-private', messages), resolveSettings({ minCaptureChars: 5 }))
  const content = plan.documents[0].content
  assert.equal(content.includes('hunter2'), false)
  assert.equal(content.includes('db-prod-42'), false)
  assert.equal(content.includes('that stays private'), false, 'the answer to a private turn survived')
  assert.match(content, /Tuesday \[redacted\]/)
  assert.equal(plan.turns, 1)
})

test('privacy helpers are precise', () => {
  assert.equal(stripPrivate('a <private>hidden</private> b'), 'a [redacted] b')
  assert.equal(isFullyPrivate('<private>x</private>', '[redacted]'), true)
  assert.equal(isFullyPrivate('visible <private>x</private>', 'visible [redacted]'), false)
  assert.equal(stripDataUris('data:image/png;base64,' + 'A'.repeat(400)), '[image]')
  assert.equal(stripDataUris('plain text'), 'plain text')
})

test('capture redaction covers URL credentials, JWTs and assignments but keeps placeholders', () => {
  const text = [
    'db https://admin:s3cr3tpass@db.internal:5432/app',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'API_KEY=live-abcdef1234567890',
    `export GITHUB_TOKEN="ghp_${'realvalue1234567890abcdef'}"`,
    'API_KEY=${SUPERMEMORY_KEY}',
    'TOKEN=your-token-here',
    'PASSWORD: changeme',
    'DATABASE_URL=https://db.example.test/app?token=prod-secret-ABCDEF123456&x=1',
    'TOKEN=example-prod-secret-ABCDEF123456',
    'PASSWORD="<prod-secret-ABCDEF123456>"',
    'token=lowercase-secret-value-123',
  ].join('\n')
  const redacted = redactSecrets(text, true)
  assert.equal(redacted.includes('s3cr3tpass'), false)
  assert.equal(redacted.includes('eyJhbGciOiJIUzI1NiJ9'), false)
  assert.equal(redacted.includes('live-abcdef1234567890'), false)
  assert.equal(redacted.includes('ghp_realvalue'), false)
  assert.equal(redacted.includes('${SUPERMEMORY_KEY}'), true, 'a template placeholder was destroyed')
  assert.equal(redacted.includes('your-token-here'), true, 'a documented placeholder was destroyed')
  assert.equal(redacted.includes('changeme'), true, 'a placeholder value was destroyed')
  assert.equal(redacted.includes('prod-secret-ABCDEF123456'), false, 'a URL query token or an example-prefixed secret survived')
  assert.equal(redacted.includes('token=[redacted]'), true)
})

test('private text echoed later or repeated in a compaction summary is redacted', () => {
  const secret = 'super-secret-customer-id-7788'
  const messages = [
    { ...userTurn(`<private>${secret}</private> please fix the deploy pipeline`), id: 'p1' },
    answer(`I will use ${secret} for the request`),
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: `curl with ${secret}` }] },
    { role: 'user', content: [{ type: 'text', text: `summary of earlier turns: the operator mentioned ${secret}` }], source: { kind: 'compact-checkpoint' } },
  ]
  const plan = buildTranscriptChunks(session('session-private-echo', messages), resolveSettings({ minCaptureChars: 5 }))
  const content = plan.documents[0].content
  assert.equal(content.includes(secret), false, 'private text echoed by the model or a summary reached memory')
  assert.match(content, /please fix the deploy pipeline/)
})

test('short and long private fragments are both redacted wherever they are echoed', () => {
  const pin = '777'
  const longSecret = `account-${'x'.repeat(460)}-tail`
  const messages = [
    { ...userTurn(`<private>${pin}</private> and <private>${longSecret}</private> please proceed`), id: 'p1' },
    answer(`confirmed ${pin} and ${longSecret}`),
  ]
  const plan = buildTranscriptChunks(session('session-private-size', messages), resolveSettings({ minCaptureChars: 5 }))
  const content = plan.documents[0].content
  assert.equal(content.includes(pin), false, 'a short private PIN was echoed into memory')
  assert.equal(content.includes(longSecret), false, 'a long private fragment was echoed into memory')
  assert.match(content, /please proceed/)
})

test('private fragments persist across capture calls so a later summary is still redacted', () => {
  const fragments = []
  const secret = 'private-address-9911'
  const first = [
    { ...userTurn(`<private>${secret}</private> book the meeting`), id: 'p1' },
    answer('booked'),
  ]
  buildTranscriptChunks(session('session-private-persist', first), resolveSettings({ minCaptureChars: 5 }), { privateFragments: fragments })
  const later = [
    { role: 'user', content: [{ type: 'text', text: `summary: earlier the operator wrote ${secret}` }], source: { kind: 'compact-checkpoint' } },
    userTurn('continue'),
  ]
  const plan = buildTranscriptChunks(session('session-private-persist', later), resolveSettings({ minCaptureChars: 5 }), { privateFragments: fragments })
  assert.equal(plan.documents[0].content.includes(secret), false)
})

test('unmatched private markers are scanned in linear time', () => {
  const hostile = '<private>'.repeat(24000)
  const started = Date.now()
  const cleaned = stripPrivate(hostile)
  const elapsed = Date.now() - started
  assert.ok(elapsed < 2000, `stripPrivate took ${elapsed} ms on ${hostile.length} bytes`)
  assert.equal(cleaned.length, hostile.length)
})

test('the captured document and metadata never carry the absolute workspace path', async () => {
  const writes = []
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', minCaptureChars: 5 },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'x', status: 'queued' } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const s = session('session-path', [userTurn('a decision worth keeping for later'), answer('noted')], { cwd: '/Users/someone/private/secret-project' })
    capture.handler(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 60))
    const body = writes[0]
    assert.equal(body.content.includes('/Users/someone/private'), false, 'the transcript header leaked the absolute path')
    assert.equal(JSON.stringify(body.metadata).includes('/Users/someone'), false, 'metadata leaked the absolute path')
    assert.equal(body.metadata.project, 'secret-project')
  } finally {
    host.restore()
  }
})

test('a git remote gives a stable path-free project identity', () => {
  assert.equal(normalizeGitRemote('git@github.com:Org/Repo.git'), 'github.com/org/repo')
  assert.equal(normalizeGitRemote('https://github.com/Org/Repo.git'), 'github.com/org/repo')
  assert.equal(normalizeGitRemote('https://user:token@GitHub.com/Org/Repo'), 'github.com/org/repo')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-git-'))
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:Acme/Api.git'], { cwd: dir, stdio: 'ignore' })
    const fromGit = projectIdentity(dir)
    assert.match(fromGit.id, /^[0-9a-f]{16}$/)
    assert.equal(fromGit.name, dir.split('/').pop())
    const withoutGit = projectIdentity(join(dir, 'nested'))
    assert.match(withoutGit.id, /^[0-9a-f]{16}$/)
    assert.notEqual(fromGit.id, withoutGit.id)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('capture sends the durable default guidance, the project id and the new dreaming default', async () => {
  const writes = []
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', minCaptureChars: 5 },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'x', status: 'queued' } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    capture.handler(session('session-official', [userTurn('we decided to use v5 filters'), answer('ok')]), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 60))
    const body = writes[0]
    assert.match(body.supportingContext, /Only extract facts that stay useful|EXTRACT only facts/)
    assert.match(body.metadata.project_id, /^[0-9a-f]{16}$/)
    assert.match(body.group.project_id, /^[0-9a-f]{16}$/)
    assert.equal(body.dreaming, 'dynamic')
  } finally {
    host.restore()
  }
})

test('an explicit empty captureContext disables the guidance', async () => {
  const writes = []
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', minCaptureChars: 5, captureContext: '' },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST' && url.endsWith('/document')) {
        writes.push(JSON.parse(String(init.body)))
        return { body: { id: 'x', status: 'queued' } }
      }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    capture.handler(session('session-no-context', [userTurn('a decision worth keeping'), answer('ok')]), { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal('supportingContext' in writes[0], false)
  } finally {
    host.restore()
  }
})

test('a failed capture is surfaced in the next recall block', async () => {
  let captureAttempts = 0
  const host = await createHost({
    config: { captureDebounceMs: 5, container: 'dsh', minCaptureChars: 5, profileFrequency: 0, captureRetries: 0 },
    fetchHandler: (url, init = {}) => {
      if (init.method === 'PATCH') return { status: 404, body: { error: 'Document not found' } }
      if (init.method === 'POST' && url.endsWith('/document')) {
        captureAttempts += 1
        return { status: 500, body: { error: 'boom' } }
      }
      if (url.includes('/search')) return { body: { results: [{ memory: 'a recalled fact about the deploy window', similarity: 0.9 }] } }
      return { body: {} }
    },
  })
  try {
    const capture = hook(host, 'session/event')
    const s = session('session-capture-fail', [userTurn('a decision that fails to store'), answer('ok')])
    capture.handler(s, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.ok(captureAttempts > 0, 'the capture never attempted a write')
    const preStep = hook(host, 'agent/pre-step')
    const human = userTurn('what did we decide about the deploy window?')
    const result = await preStep.handler(
      { agent: { id: 'session-capture-fail', session: { header: {} } }, messages: [human], turn: 2, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter', messages: [human] }),
    )
    const injected = result.messages.find(message => message.source && message.source.kind === 'supermemory')
    assert.ok(injected, 'no recall block was injected')
    assert.match(injected.content[0].text, /memory capture of the last turn failed \(error\)/)
  } finally {
    host.restore()
  }
})
