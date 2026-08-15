import { describe, expect, it, vi } from 'vitest'

import { isCommand, runCommand, type CommandContext } from '../../src/cli/commands.ts'

function makeCtx(): CommandContext & { printed: string[] } {
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

describe('isCommand', () => {
  it('recognizes slash lines', () => {
    expect(isCommand('/help')).toBe(true)
    expect(isCommand('/help extra')).toBe(true)
  })

  it('rejects prose, empty input, and a bare slash', () => {
    expect(isCommand('not a command')).toBe(false)
    expect(isCommand('')).toBe(false)
    expect(isCommand('/')).toBe(false)
  })
})

describe('runCommand', () => {
  it('prints dimmed, alphabetically sorted slash help for /help', () => {
    const ctx = makeCtx()
    runCommand('/help', ctx)
    expect(ctx.dim).toHaveBeenCalledOnce()
    const output = ctx.printed.join('\n')
    const commands = ['/clear', '/exit', '/help', '/model', '/mode', '/reset']
    const indexes = commands.map((cmd) => output.indexOf(cmd))
    expect(indexes.every((i) => i >= 0)).toBe(true)
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('clears the terminal for /clear', () => {
    const ctx = makeCtx()
    runCommand('/clear', ctx)
    expect(ctx.clearScreen).toHaveBeenCalledOnce()
    expect(ctx.resetConversation).not.toHaveBeenCalled()
  })

  it('resets the conversation for /reset', () => {
    const ctx = makeCtx()
    runCommand('/reset', ctx)
    expect(ctx.resetConversation).toHaveBeenCalledOnce()
    expect(ctx.printed.join('\n')).toContain('conversation reset')
  })

  it('prints the active model for /model', () => {
    const ctx = makeCtx()
    runCommand('/model', ctx)
    expect(ctx.printed.join('\n')).toContain('gpt-fake')
  })

  it('prints the current mode for /mode', () => {
    const ctx = makeCtx()
    runCommand('/mode', ctx)
    expect(ctx.printed.join('\n')).toContain('interactive')
  })

  it('exits for /exit', () => {
    const ctx = makeCtx()
    runCommand('/exit', ctx)
    expect(ctx.exit).toHaveBeenCalledOnce()
  })

  it('reports unknown commands and points at /help', () => {
    const ctx = makeCtx()
    expect(runCommand('/bogus', ctx)).toBe(true)
    const output = ctx.printed.join('\n')
    expect(output).toContain('/bogus')
    expect(output).toContain('/help')
  })
})
