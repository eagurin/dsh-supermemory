import test from 'node:test'
import assert from 'node:assert/strict'
import { writableContainers, resolveSettings } from './helpers.mjs'

// The security invariant of this plugin: another agent's memory is readable and
// never writable unless the operator turns it on explicitly.

test('only the own namespace is writable by default', () => {
  const settings = resolveSettings({})
  const writable = writableContainers(settings, ['hermes_default', 'hermes'])
  assert.deepEqual(writable, ['dsh'])
})

test("Hermes namespaces stay read-only even when discovered", () => {
  const settings = resolveSettings({ readContainers: ['hermes_default', 'hermes', 'hermes_omh'] })
  const writable = writableContainers(settings, settings.readContainers)
  assert.equal(writable.includes('hermes_default'), false)
  assert.equal(writable.includes('hermes_omh'), false)
})

test('extra write namespaces are opt-in per name', () => {
  const settings = resolveSettings({ writeContainers: ['notes', 'projects'] })
  const writable = writableContainers(settings, ['hermes_default'])
  assert.deepEqual(writable, ['dsh', 'notes', 'projects'])
})

test('allowWritesToReadContainers covers listed readable namespaces but never Hermes', () => {
  const closed = resolveSettings({ readContainers: ['notes'] })
  assert.equal(writableContainers(closed, ['notes']).includes('notes'), false)
  const opened = resolveSettings({ readContainers: ['notes', 'hermes_default'], allowWritesToReadContainers: true })
  const writable = writableContainers(opened, ['notes', 'hermes_default'])
  assert.equal(writable.includes('notes'), true)
  assert.equal(writable.includes('hermes_default'), false)
})

test('write namespaces are sanitized like read namespaces', () => {
  const settings = resolveSettings({ writeContainers: ['bad name', 'ok-name'] })
  assert.deepEqual(writableContainers(settings, []), ['dsh', 'bad_name', 'ok-name'])
})
