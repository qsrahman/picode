import { describe, expect, it, vi } from 'vitest'

import { runTurn } from '../../src/agent/agent.ts'
import type { Provider, ProviderMessage } from '../../src/agent/provider.ts'

function fakeProvider(reply = 'hello'): Provider {
  return {
    model: 'fake',
    complete: vi.fn(async () => reply),
  }
}

describe('runTurn', () => {
  it('appends the user message and assistant reply to empty history', async () => {
    const result = await runTurn(fakeProvider('hello back'), [], 'hi')
    expect(result).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello back' },
    ])
  })

  it('preserves existing history', async () => {
    const history: ProviderMessage[] = [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]
    const result = await runTurn(fakeProvider('a2'), history, 'q2')
    expect(result).toEqual([
      ...history,
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ])
  })

  it('passes the full history and options to the provider', async () => {
    const provider = fakeProvider('ok')
    const controller = new AbortController()
    const history: ProviderMessage[] = [{ role: 'user', content: 'q1' }]
    await runTurn(provider, history, 'q2', { signal: controller.signal })
    expect(provider.complete).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'q1' },
        { role: 'user', content: 'q2' },
      ],
      { signal: controller.signal },
    )
  })

  it('propagates provider errors', async () => {
    const provider: Provider = {
      model: 'fake',
      complete: vi.fn(async () => {
        throw new Error('boom')
      }),
    }
    await expect(runTurn(provider, [], 'hi')).rejects.toThrow('boom')
  })
})
