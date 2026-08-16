import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { HISTORY_SIZE, loadHistory, saveHistory } from '../../src/cli/history.ts'

describe('history', () => {
  it('round-trips entries via save and load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picode-test-'))
    const path = join(dir, 'history')
    const entries = ['first', 'second', 'third']

    saveHistory(path, entries)
    const loaded = loadHistory(path)

    expect(loaded).toEqual(entries)
  })

  it('returns empty array for missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picode-test-'))
    const path = join(dir, 'nonexistent', 'history')

    const loaded = loadHistory(path)

    expect(loaded).toEqual([])
  })

  it('filters out empty lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picode-test-'))
    const path = join(dir, 'history')
    saveHistory(path, ['a', '', 'b', '', 'c'])

    const loaded = loadHistory(path)

    expect(loaded).toEqual(['a', 'b', 'c'])
  })

  it('caps entries at HISTORY_SIZE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picode-test-'))
    const path = join(dir, 'history')
    const entries = Array.from({ length: HISTORY_SIZE + 100 }, (_, i) => `line-${i}`)

    saveHistory(path, entries)
    const loaded = loadHistory(path)

    expect(loaded.length).toBe(HISTORY_SIZE)
    expect(loaded[0]).toBe(`line-100`)
    expect(loaded[HISTORY_SIZE - 1]).toBe(`line-${HISTORY_SIZE + 99}`)
  })

  it('creates parent directories on save', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picode-test-'))
    const path = join(dir, 'a', 'b', 'c', 'history')

    saveHistory(path, ['entry'])
    const loaded = loadHistory(path)

    expect(loaded).toEqual(['entry'])
  })

  it('writes an empty file for empty entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picode-test-'))
    const path = join(dir, 'history')

    saveHistory(path, [])
    const loaded = loadHistory(path)

    expect(loaded).toEqual([])
  })
})
