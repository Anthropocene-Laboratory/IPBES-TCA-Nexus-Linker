import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Guard the reference datasets. They are derived from the source workbook by
// scripts/extract_definitions.py; these assertions fail loudly if a
// re-extraction drops records, loses definitions or breaks the identifiers the
// stored expert links point at.

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const load = (name) => JSON.parse(readFileSync(join(root, 'src', 'data', name), 'utf-8'))

const actions = load('tca_actions.json')
const options = load('nexus_options.json')

test('TCA actions: 22 records grouped in 5 strategies', () => {
  assert.equal(actions.length, 22)
  assert.equal(new Set(actions.map((a) => a.strategy)).size, 5)
})

test('TCA actions: identifiers are unique and non-empty', () => {
  const ids = actions.map((a) => a.id)
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0))
  assert.equal(new Set(ids).size, ids.length)
})

test('TCA actions: every record carries a title and a definition', () => {
  for (const a of actions) {
    assert.ok(a.action?.length > 0, `missing action title for ${a.id}`)
    assert.ok(a.definition?.length > 0, `missing definition for ${a.id}`)
  }
})

test('Nexus options: 71 records grouped in 10 categories', () => {
  assert.equal(options.length, 71)
  assert.equal(new Set(options.map((o) => o.category)).size, 10)
})

test('Nexus options: codes are unique and non-empty', () => {
  const ids = options.map((o) => o.id)
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0))
  assert.equal(new Set(ids).size, ids.length)
})

test('Nexus options: every record carries a title and a definition', () => {
  for (const o of options) {
    assert.ok(o.title?.length > 0, `missing title for ${o.id}`)
    assert.ok(o.definition?.length > 0, `missing definition for ${o.id}`)
  }
})

test('identifier spaces do not collide across the two datasets', () => {
  const actionIds = new Set(actions.map((a) => a.id))
  const overlap = options.filter((o) => actionIds.has(o.id))
  assert.equal(overlap.length, 0)
})
