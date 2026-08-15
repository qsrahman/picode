import { describe, expect, it } from 'vitest'
import { HELP_TEXT } from '../../src/cli/help.ts'

const flags = [
  '--model',
  '--mode',
  '--yes',
  '--plan',
  '--config',
  '--no-stream',
  '--verbose',
  '--no-color',
  '--version',
  '--help',
]

describe('HELP_TEXT', () => {
  it('shows the usage line', () => {
    expect(HELP_TEXT).toContain('pcode [prompt]')
  })

  it('documents every supported flag', () => {
    for (const flag of flags) {
      expect(HELP_TEXT, `missing ${flag}`).toContain(flag)
    }
  })

  it('documents the permission modes', () => {
    expect(HELP_TEXT).toContain('interactive')
    expect(HELP_TEXT).toContain('auto')
    expect(HELP_TEXT).toContain('plan')
  })
})
