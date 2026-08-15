import { describe, expect, it, vi } from 'vitest'

import { isSlashCommand, runSlashCommand, type SlashContext } from '../../src/cli/commands.ts'

function makeCtx(): SlashContext & { printed: string[] } {
  const printed: string[] = []
  return {
    print: vi.fn((line: string) => {
      printed.push(line)
    }),
    clearHistory: vi.fn(),
    exit: vi.fn(),
    model: 'gpt-fake',
    mode: 'interactive',
    printed,
  }
}

describe('isSlashCommand', () => {
  it('recognizes slash lines', () => {
    expect(isSlashCommand('/help')).toBe(true)
    expect(isSlashCommand('/help extra')).toBe(true)
  })

  it('rejects prose, empty input, and a bare slash', () => {
    expect(isSlashCommand('not a command')).toBe(false)
    expect(isSlashCommand('')).toBe(false)
    expect(isSlashCommand('/')).toBe(false)
  })
})

describe('runSlashCommand', () => {
  it('prints slash help for /help', () => {
    const ctx = makeCtx()
    runSlashCommand('/help', ctx)
    expect(ctx.printed.join('\n')).toContain('/exit')
  })

  it('clears history for /clear', () => {
    const ctx = makeCtx()
    runSlashCommand('/clear', ctx)
    expect(ctx.clearHistory).toHaveBeenCalledOnce()
  })

  it('prints the active model for /model', () => {
    const ctx = makeCtx()
    runSlashCommand('/model', ctx)
    expect(ctx.printed.join('\n')).toContain('gpt-fake')
  })

  it('prints the current mode for /mode', () => {
    const ctx = makeCtx()
    runSlashCommand('/mode', ctx)
    expect(ctx.printed.join('\n')).toContain('interactive')
  })

  it('exits for /exit', () => {
    const ctx = makeCtx()
    runSlashCommand('/exit', ctx)
    expect(ctx.exit).toHaveBeenCalledOnce()
  })

  it('reports unknown commands and points at /help', () => {
    const ctx = makeCtx()
    expect(runSlashCommand('/bogus', ctx)).toBe(true)
    const output = ctx.printed.join('\n')
    expect(output).toContain('/bogus')
    expect(output).toContain('/help')
  })
})
