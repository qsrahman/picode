import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/version.ts'

describe('VERSION', () => {
  it('exposes a semantic version string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
