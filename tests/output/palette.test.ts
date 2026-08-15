import ansis from 'ansis'

import { describe, expect, it } from 'vitest'

import { createPalette, shouldUseColor } from '../../src/output/palette.ts'

describe('createPalette', () => {
  it('styles every method when color is enabled', () => {
    const palette = createPalette(true)
    for (const key of ['prompt', 'promptMuted', 'tool', 'error', 'tip'] as const) {
      expect(palette[key]('x'), key).toMatch(/\u001b\[/)
    }
  })

  it('returns plain strings when color is disabled', () => {
    const palette = createPalette(false)
    expect(palette.prompt('x')).toBe('x')
    expect(palette.promptMuted('x')).toBe('x')
    expect(palette.tool('x')).toBe('x')
    expect(palette.error('x')).toBe('x')
    expect(palette.tip('x')).toBe('x')
  })

  it('leaves assistant text unstyled', () => {
    expect(createPalette(true).assistant('hello')).toBe('hello')
  })

  it('strips cleanly with ansis.strip', () => {
    expect(ansis.strip(createPalette(true).prompt('hi'))).toBe('hi')
  })
})

describe('shouldUseColor', () => {
  it('defaults to true', () => {
    expect(shouldUseColor({ noColor: false }, {})).toBe(true)
  })

  it('honors --no-color', () => {
    expect(shouldUseColor({ noColor: true }, {})).toBe(false)
  })

  it('honors the NO_COLOR env var', () => {
    expect(shouldUseColor({ noColor: false }, { NO_COLOR: '1' })).toBe(false)
  })

  it('lets --no-color win over a missing NO_COLOR', () => {
    expect(shouldUseColor({ noColor: true }, { NO_COLOR: undefined })).toBe(false)
  })
})
