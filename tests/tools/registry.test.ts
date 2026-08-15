import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ToolRegistry } from '../../src/tools/registry.ts'
import type { Tool, ToolCall } from '../../src/tools/types.ts'

function fakeTool(name: string, reply = 'ok'): Tool {
  return {
    name,
    description: `the ${name} tool`,
    input: z.object({ x: z.string() }),
    execute: vi.fn(async (args: unknown) => `${reply}:${(args as { x: string }).x}`),
  }
}

describe('ToolRegistry', () => {
  it('registers, looks up, and lists tools', () => {
    const reg = new ToolRegistry()
    const tool = fakeTool('a')
    reg.register(tool)
    expect(reg.get('a')).toBe(tool)
    expect(reg.names()).toEqual(['a'])
    expect(reg.get('nope')).toBeUndefined()
  })

  it('rejects duplicate names', () => {
    const reg = new ToolRegistry()
    reg.register(fakeTool('a'))
    expect(() => reg.register(fakeTool('a'))).toThrow(/duplicate tool name/)
  })

  it('builds function descriptors for the API', () => {
    const reg = new ToolRegistry()
    reg.register(fakeTool('a'))
    expect(reg.descriptors()).toEqual([
      {
        type: 'function',
        name: 'a',
        description: 'the a tool',
        parameters: {
          type: 'object',
          properties: { x: { type: 'string' } },
          required: ['x'],
          additionalProperties: false,
        },
      },
    ])
  })

  it('filters the toolset to the given names', () => {
    const reg = new ToolRegistry()
    reg.register(fakeTool('a'))
    reg.register(fakeTool('b'))
    const sub = reg.filter(['a'])
    expect(sub.names()).toEqual(['a'])
    expect(sub.get('b')).toBeUndefined()
  })

  it('executes a call and returns the tool output', async () => {
    const reg = new ToolRegistry()
    const tool = fakeTool('a', 'hi')
    reg.register(tool)
    const call: ToolCall = { callId: 'c1', name: 'a', args: { x: 'v' } }
    await expect(reg.execute(call)).resolves.toEqual({
      callId: 'c1',
      name: 'a',
      output: 'hi:v',
    })
    expect(tool.execute).toHaveBeenCalledWith({ x: 'v' })
  })

  it('returns an error string for unknown tools', async () => {
    const reg = new ToolRegistry()
    await expect(reg.execute({ callId: 'c1', name: 'nope', args: {} })).resolves.toEqual({
      callId: 'c1',
      name: 'nope',
      output: 'unknown tool: nope',
    })
  })

  it('returns an error string for invalid arguments', async () => {
    const reg = new ToolRegistry()
    reg.register(fakeTool('a'))
    const result = await reg.execute({ callId: 'c1', name: 'a', args: {} })
    expect(result.output).toMatch(/invalid arguments for a/)
  })

  it('captures tool exceptions as error strings', async () => {
    const reg = new ToolRegistry()
    reg.register({
      name: 'boom',
      description: 'boom',
      input: z.object({}),
      execute: async () => {
        throw new Error('kaboom')
      },
    })
    await expect(reg.execute({ callId: 'c1', name: 'boom', args: {} })).resolves.toEqual({
      callId: 'c1',
      name: 'boom',
      output: 'boom failed: kaboom',
    })
  })
})
