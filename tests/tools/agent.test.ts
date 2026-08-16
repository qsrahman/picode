import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createAgentTool, runAgentToolName } from '../../src/tools/agent.ts'
import { ApprovalCache } from '../../src/permissions/policy.ts'
import { defaultPermission, type Config } from '../../src/config/schema.ts'
import { ToolRegistry } from '../../src/tools/registry.ts'
import type { Provider, ProviderItem, ProviderStream } from '../../src/agent/provider.ts'

interface FakeResponse {
  items: ProviderItem[]
  text: string
}

// No deltas needed for these tests — run_agent doesn't stream.
function toStream(resp: FakeResponse): ProviderStream {
  return {
    [Symbol.asyncIterator]: async function* () {},
    finalOutput: async () => ({ items: resp.items, text: resp.text }),
  }
}

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

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    model: 'fake',
    baseURL: 'http://localhost',
    apiKeyEnv: 'OPENAI_API_KEY',
    braveSearchApiKeyEnv: 'BRAVE_SEARCH_API_KEY',
    instructions: '',
    root: process.cwd(),
    additionalDirs: [],
    mode: 'interactive',
    permission: defaultPermission,
    maxTokens: 1024,
    maxRetries: 0,
    toolTimeout: 1000,
    ...overrides,
  }
}

describe('run_agent', () => {
  it('rejects empty description/prompt', () => {
    const registry = new ToolRegistry()
    const tool = createAgentTool({
      provider: fakeProvider([]),
      registry,
      config: baseConfig(),
      approvals: new ApprovalCache(),
    })
    expect(tool.input.safeParse({ description: '', prompt: 'x' }).success).toBe(false)
    expect(tool.input.safeParse({ description: 'x', prompt: '' }).success).toBe(false)
    expect(tool.input.safeParse({ description: 'x', prompt: 'y' }).success).toBe(true)
  })

  it('returns the sub-agent final text from an isolated conversation', async () => {
    const registry = new ToolRegistry()
    const provider = fakeProvider([
      { items: [{ type: 'message', role: 'assistant', content: 'done' }], text: 'done' },
    ])
    const tool = createAgentTool({
      provider,
      registry,
      config: baseConfig(),
      approvals: new ApprovalCache(),
    })

    const out = await tool.execute({ description: 'count files', prompt: 'count the files' })

    expect(out).toBe('done')
    // Fresh conversation: only the sub-agent's own prompt is sent, not any
    // parent history.
    expect(vi.mocked(provider.stream)).toHaveBeenCalledWith(
      [{ role: 'user', content: 'count the files' }],
      expect.anything(),
    )
  })

  it('denies an inner tool call with no allow rule, without prompting', async () => {
    const inner = vi.fn(async () => 'should not run')
    const registry = new ToolRegistry()
    registry.register({
      name: 'mystery_tool',
      description: 'a tool with no permission mapping',
      input: z.object({}),
      execute: inner,
    })
    const provider = fakeProvider([
      {
        items: [{ type: 'function_call', call_id: 'c1', name: 'mystery_tool', arguments: '{}' }],
        text: '',
      },
      { items: [{ type: 'message', role: 'assistant', content: 'blocked' }], text: 'blocked' },
    ])
    const tool = createAgentTool({
      provider,
      registry,
      config: baseConfig(),
      approvals: new ApprovalCache(),
    })

    const out = await tool.execute({ description: 'try mystery', prompt: 'call mystery_tool' })

    expect(inner).not.toHaveBeenCalled()
    expect(out).toBe('blocked')
  })

  it('allows an inner tool call already covered by an allow rule', async () => {
    const inner = vi.fn(async () => 'ran')
    const registry = new ToolRegistry()
    registry.register({
      name: 'run_command',
      description: 'run a shell command',
      input: z.object({ command: z.string() }),
      execute: inner,
    })
    const provider = fakeProvider([
      {
        items: [
          {
            type: 'function_call',
            call_id: 'c1',
            name: 'run_command',
            arguments: '{"command":"ls"}',
          },
        ],
        text: '',
      },
      { items: [{ type: 'message', role: 'assistant', content: 'done' }], text: 'done' },
    ])
    const config = baseConfig({
      permission: { ...defaultPermission, shell: { allow: ['Bash(ls)'], ask: [], deny: [] } },
    })
    const tool = createAgentTool({ provider, registry, config, approvals: new ApprovalCache() })

    const out = await tool.execute({ description: 'list files', prompt: 'run ls' })

    expect(inner).toHaveBeenCalledOnce()
    expect(out).toBe('done')
  })

  it('refuses to nest when re-entered before the outer call settles', async () => {
    const registry = new ToolRegistry()
    // Never resolves on its own within this test's synchronous window — the
    // guard must fire before the outer runTurn call even starts awaiting.
    const provider = fakeProvider([
      {
        items: [{ type: 'message', role: 'assistant', content: 'outer done' }],
        text: 'outer done',
      },
    ])
    const tool = createAgentTool({
      provider,
      registry,
      config: baseConfig(),
      approvals: new ApprovalCache(),
    })

    const outer = tool.execute({ description: 'outer', prompt: 'outer task' })
    const inner = tool.execute({ description: 'inner', prompt: 'inner task' })

    const [outerResult, innerResult] = await Promise.all([outer, inner])
    expect(innerResult).toContain('cannot be called from within a sub-agent')
    expect(outerResult).toBe('outer done')
  })

  it('is not offered to the sub-agent itself (excluded from its toolset)', async () => {
    const registry = new ToolRegistry()
    let seenTools: unknown
    const provider: Provider = {
      model: 'fake',
      stream: vi.fn(async (_input, options) => {
        seenTools = options.tools
        return toStream({ items: [], text: 'ok' })
      }),
    }
    registry.register(
      createAgentTool({ provider, registry, config: baseConfig(), approvals: new ApprovalCache() }),
    )
    const tool = registry.get(runAgentToolName)!

    await tool.execute({ description: 'x', prompt: 'y' })

    expect(seenTools).toEqual([])
  })

  it('caps a very long sub-agent report', async () => {
    const registry = new ToolRegistry()
    const long = 'x'.repeat(7000)
    const provider = fakeProvider([
      { items: [{ type: 'message', role: 'assistant', content: long }], text: long },
    ])
    const tool = createAgentTool({
      provider,
      registry,
      config: baseConfig(),
      approvals: new ApprovalCache(),
    })

    const out = await tool.execute({ description: 'long', prompt: 'write a lot' })

    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain('output truncated')
  })
})
