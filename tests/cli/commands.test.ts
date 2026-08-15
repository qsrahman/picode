import { describe, expect, it, vi } from 'vitest'

import { isSlashCommand, runSlashCommand, type SlashContext } from '../../src/cli/commands.ts'

function makeCtx(): SlashContext & { printed: string[] } {
  const printed: string[] = []
  return {
    print: vi.fn((line: string) => {
      printed.push(line)
    }),
    dim: vi.fn((s: string) => s),
    clearScreen: vi.fn(),
    resetConversation: vi.fn(),
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
  it('prints dimmed, alphabetically sorted slash help for /help', () => {
    const ctx = makeCtx()
    runSlashCommand('/help', ctx)
    expect(ctx.dim).toHaveBeenCalledOnce()
    const output = ctx.printed.join('\n')
    const commands = ['/clear', '/exit', '/help', '/model', '/mode', '/reset']
    const indexes = commands.map((cmd) => output.indexOf(cmd))
    expect(indexes.every((i) => i >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('clears the terminal for /clear', () => {
    const ctx = makeCtx()
    runSlashCommand('/clear', ctx)
    expect(ctx.clearScreen).toHaveBeenCalledOnce()
    expect(ctx.resetConversation).not.toHaveBeenCalled()
  })

  it('resets the conversation for /reset', () => {
    const ctx = makeCtx()
    runSlashCommand('/reset', ctx)
    expect(ctx.resetConversation).toHaveBeenCalledOnce()
    expect(ctx.printed.join('\n')).toContain('conversation reset')
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
