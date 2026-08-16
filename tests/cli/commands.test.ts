import { describe, expect, it, vi } from 'vitest'

import {
  isCommand,
  runCommand,
  type CommandContext,
  type ToolStatus,
} from '../../src/cli/commands.ts'

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
    setMode: vi.fn(),
    toolStatus: vi.fn((): ToolStatus[] => [
      { name: 'read_file', status: 'allow' },
      { name: 'write_file', status: 'ask' },
      { name: 'run_command', status: 'deny' },
    ]),
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
    for (const cmd of ['/clear', '/exit', '/help', '/model', '/mode', '/reset', '/tools']) {
      expect(output).toContain(cmd)
    }
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

  it('switches mode for /mode <name>', () => {
    const ctx = makeCtx()
    runCommand('/mode plan', ctx)
    expect(ctx.setMode).toHaveBeenCalledWith('plan')
    expect(ctx.printed.join('\n')).toContain('plan')
  })

  it('rejects an unknown mode for /mode <name>', () => {
    const ctx = makeCtx()
    runCommand('/mode bogus', ctx)
    expect(ctx.setMode).not.toHaveBeenCalled()
    expect(ctx.printed.join('\n')).toContain('unknown mode')
  })

  it('lists tools with their effective permission for /tools', () => {
    const ctx = makeCtx()
    runCommand('/tools', ctx)
    const output = ctx.printed.join('\n')
    expect(output).toContain('read_file')
    expect(output).toContain('allow')
    expect(output).toContain('deny')
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
