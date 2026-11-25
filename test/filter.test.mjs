import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFilter } from './helpers.mjs'

test('a plain predicate is normalized', () => {
  assert.deepEqual(
    normalizeFilter({ field: 'type', operator: 'neq', value: 'conversation' }),
    { field: 'type', operator: 'neq', value: 'conversation' },
  )
})

test('caseSensitive and numeric values survive', () => {
  assert.deepEqual(
    normalizeFilter({ field: 'turns', operator: 'gte', value: 5, caseSensitive: false }),
    { field: 'turns', operator: 'gte', value: 5, caseSensitive: false },
  )
})

test('and/or expressions nest', () => {
  const filter = normalizeFilter({
    operator: 'and',
    operands: [
      { field: 'source_agent', operator: 'eq', value: 'deepseek-harness' },
      { field: 'type', operator: 'neq', value: 'conversation' },
    ],
  })
  assert.equal(filter.operator, 'and')
  assert.equal(filter.operands.length, 2)
  assert.equal(filter.operands[1].field, 'type')
})

test('invalid filters name the problem', () => {
  assert.throws(() => normalizeFilter('{not json'), /expected JSON metadata filters/)
  assert.throws(() => normalizeFilter({ field: 'bad field', operator: 'eq', value: 'x' }), /\^\[a-zA-Z0-9_.-\]\+\$/)
  assert.throws(() => normalizeFilter({ field: 'type', operator: 'like', value: 'x' }), /unsupported operator/)
  assert.throws(() => normalizeFilter({ field: 'type', operator: 'eq', value: { nested: 1 } }), /must be a string, number, or boolean/)
  assert.throws(() => normalizeFilter({ operator: 'and', operands: [] }), /non-empty operands/)
  assert.throws(() => normalizeFilter([{ field: 'a', operator: 'eq', value: 'b' }]), /expected a filter object/)
})

test('absent filters are undefined, not empty objects', () => {
  assert.equal(normalizeFilter(undefined), undefined)
  assert.equal(normalizeFilter(''), undefined)
  assert.equal(normalizeFilter('  '), undefined)
})
