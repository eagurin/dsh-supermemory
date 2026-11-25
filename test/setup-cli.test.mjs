import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts/setup.mjs')

/** Run the setup CLI the way a stranger would. */
function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SUPERMEMORY_LOCAL_URL: 'http://127.0.0.1:1' },
  })
}

test('the human path prints a complete row and next steps', () => {
  // Port 1 refuses connections, so the local probe fails and --mode answers it.
  const result = run(['--mode', 'local', '--no-probe'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /- id: supermemory/)
  assert.match(result.stdout, /name: '@local\/dsh-supermemory'/)
  for (const key of ['baseUrl', 'apiKeyRef', 'container', 'readContainers', 'allowFileUpload', 'redactSecrets']) {
    assert.match(result.stdout, new RegExp(`    ${key}:`), `row is missing ${key}`)
  }
  assert.match(result.stdout, /Next steps/)
  assert.match(result.stdout, /plugin_manager install_bundle/)
  assert.match(result.stdout, /Plugins → Add plugin/)
  assert.match(result.stdout, /credential store/)
})

test('--json returns a machine plan with a mode', () => {
  const result = run(['--mode', 'cloud', '--json', '--no-probe'])
  assert.equal(result.status, 0, result.stderr)
  const plan = JSON.parse(result.stdout)
  assert.equal(plan.mode, 'cloud')
  assert.equal(plan.baseUrl, 'https://api.supermemory.ai')
  assert.match(plan.row, /- id: supermemory/)
})

test('no mode, no TTY and no server is a decision, not a silent default', () => {
  const result = run(['--json'])
  assert.equal(result.status, 3)
  const decision = JSON.parse(result.stderr)
  assert.equal(decision.needDecision, true)
  assert.equal(decision.options.length, 2)
})

test('a bad mode fails with a clear message', () => {
  const result = run(['--mode', 'sneaky'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--mode must be "local" or "cloud"/)
})
