import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { MAX_TOOL_ROUNDS, runTurn } from '../../src/agent/agent.ts'
import type {
  Provider,
  ProviderEvent,
  ProviderItem,
  ProviderStream,
} from '../../src/agent/provider.ts'
import { ToolRegistry } from '../../src/tools/registry.ts'
import type { ToolDescriptor } from '../../src/tools/types.ts'

interface FakeResponse {
  deltas: string[]
  items: ProviderItem[]
  text: string
}

function toStream(resp: FakeResponse): ProviderStream {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const delta of resp.deltas) yield { type: 'text_delta', delta } satisfies ProviderEvent
    },
    finalOutput: async () => ({ items: resp.items, text: resp.text }),
  }
}

// Each stream() call shifts the next scripted response off the queue, like the
// real provider serving one Responses round per call.
function fakeProvider(responses: FakeResponse[]): Provider {
  const queue = [...responses]
  return {
    model: 'fake',
    stream: vi.fn(async () => {
      const next = queue.shift()
      if (!next) throw new Error('provider exhausted its scripted responses')
      return toStream(next)
    }),
  }
}

function callingProvider(call: ProviderItem): Provider {
  return {
    model: 'fake',
    stream: vi.fn(async () => toStream({ deltas: [], items: [call], text: '' })),
  }
}

function addRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    name: 'add',
    description: 'add two numbers',
    input: z.object({ a: z.number(), b: z.number() }),
    execute: async (args) => {
      const { a, b } = args as { a: number; b: number }
      return String(a + b)
    },
  })
  return registry
}

describe('runTurn', () => {
  it('streams text deltas and returns the final response', async () => {
    const provider = fakeProvider([
      {
        deltas: ['Hel', 'lo'],
        items: [{ type: 'message', role: 'assistant', content: 'Hello' }],
        text: 'Hello',
      },
    ])
    const onText = vi.fn()
    const result = await runTurn(provider, [], 'hi', { onText })

    expect(onText).toHaveBeenNthCalledWith(1, 'Hel')
    expect(onText).toHaveBeenNthCalledWith(2, 'lo')
    expect(result).toEqual({
      items: [
        { role: 'user', content: 'hi' },
        { type: 'message', role: 'assistant', content: 'Hello' },
      ],
      text: 'Hello',
      truncated: false,
    })
  })

  it('preserves history and forwards the tools and AbortController signal', async () => {
    const history: ProviderItem[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]
    const controller = new AbortController()
    const tools: ToolDescriptor[] = [
      { type: 'function', name: 'add', description: 'add', parameters: {} },
    ]
    const provider = fakeProvider([{ deltas: [], items: [], text: 'a2' }])

    const result = await runTurn(provider, history, 'q2', { controller, tools })

    expect(vi.mocked(provider.stream)).toHaveBeenCalledWith(
      [...history, { role: 'user', content: 'q2' }],
      { tools, signal: controller.signal },
    )
    expect(result.items).toEqual([...history, { role: 'user', content: 'q2' }])
    expect(result.text).toBe('a2')
  })

  it('executes tool calls and feeds the output back into the next round', async () => {
    const registry = addRegistry()
    const provider = fakeProvider([
      {
        deltas: [],
        items: [
          { type: 'function_call', call_id: 'call_1', name: 'add', arguments: '{"a":2,"b":3}' },
        ],
        text: '',
      },
      { deltas: ['5'], items: [{ type: 'message', role: 'assistant', content: '5' }], text: '5' },
    ])

    const result = await runTurn(provider, [], '2+3?', { registry })

    expect(vi.mocked(provider.stream)).toHaveBeenCalledTimes(2)
    const secondInput = vi.mocked(provider.stream).mock.calls[1]![0]
    expect(secondInput).toContainEqual({
      type: 'function_call',
      call_id: 'call_1',
      name: 'add',
      arguments: '{"a":2,"b":3}',
    })
    expect(secondInput).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '5',
    })
    expect(result.text).toBe('5')
    expect(result.truncated).toBe(false)
  })

  it('reports executed tool calls with elapsed time', async () => {
    const registry = addRegistry()
    const provider = fakeProvider([
      {
        deltas: [],
        items: [{ type: 'function_call', call_id: 'c1', name: 'add', arguments: '{"a":1,"b":1}' }],
        text: '',
      },
      { deltas: [], items: [{ type: 'message', role: 'assistant', content: '2' }], text: '2' },
    ])
    const onToolResult = vi.fn()

    await runTurn(provider, [], 'add', { registry, onToolResult })

    expect(onToolResult).toHaveBeenCalledTimes(1)
    const [call, result, ms] = onToolResult.mock.calls[0]!
    expect(call).toEqual({ callId: 'c1', name: 'add', args: { a: 1, b: 1 } })
    expect(result).toMatchObject({ callId: 'c1', name: 'add', output: '2' })
    expect(ms).toBeGreaterThanOrEqual(0)
  })

  it('asks for approval before executing and reports denial', async () => {
    const registry = new ToolRegistry()
    registry.register({
      name: 'run',
      description: 'run a command',
      input: z.object({ cmd: z.string() }),
      execute: async () => 'executed',
    })
    const requestApproval = vi.fn(async () => false)
    const provider = fakeProvider([
      {
        deltas: [],
        items: [{ type: 'function_call', call_id: 'c1', name: 'run', arguments: '{"cmd":"ls"}' }],
        text: '',
      },
      {
        deltas: [],
        items: [{ type: 'message', role: 'assistant', content: 'skipped' }],
        text: 'skipped',
      },
    ])

    const result = await runTurn(provider, [], 'run ls', { registry, requestApproval })

    expect(requestApproval).toHaveBeenCalledWith({ callId: 'c1', name: 'run', args: { cmd: 'ls' } })
    expect(result.items).toContainEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: 'tool call denied by user',
    })
    expect(result.text).toBe('skipped')
  })

  it('returns tool errors as output strings for the model to react to', async () => {
    const registry = addRegistry()
    const provider = fakeProvider([
      {
        deltas: [],
        items: [{ type: 'function_call', call_id: 'c1', name: 'nope', arguments: '{}' }],
        text: '',
      },
      {
        deltas: ['ok'],
        items: [{ type: 'message', role: 'assistant', content: 'ok' }],
        text: 'ok',
      },
    ])

    const result = await runTurn(provider, [], 'call nope', { registry })

    expect(result.items).toContainEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: 'unknown tool: nope',
    })
  })

  it('stops after MAX_TOOL_ROUNDS and reports truncation', async () => {
    const provider = callingProvider({
      type: 'function_call',
      call_id: 'c1',
      name: 'add',
      arguments: '{"a":1,"b":1}',
    })

    const result = await runTurn(provider, [], 'keep going', { registry: addRegistry() })

    expect(result.truncated).toBe(true)
    expect(result.text).toBe('')
    expect(vi.mocked(provider.stream)).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
  })

  it('propagates provider setup errors', async () => {
    const provider: Provider = {
      model: 'fake',
      stream: async () => {
        throw new Error('boom')
      },
    }
    await expect(runTurn(provider, [], 'hi')).rejects.toThrow('boom')
  })

  it('propagates stream iteration errors', async () => {
    const provider: Provider = {
      model: 'fake',
      stream: async () => ({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('stream failed')
        },
        finalOutput: async () => ({ items: [], text: '' }),
      }),
    }
    await expect(runTurn(provider, [], 'hi')).rejects.toThrow('stream failed')
  })
})
