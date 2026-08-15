import type { Provider, ProviderMessage } from './provider.ts'

export interface RunOptions {
  signal?: AbortSignal
}

// One model turn: append the user message, call the provider, return the full
// conversation (previous history + this turn) for the caller to keep.
export async function runTurn(
  provider: Provider,
  history: ProviderMessage[],
  input: string,
  options: RunOptions = {},
): Promise<ProviderMessage[]> {
  const messages: ProviderMessage[] = [...history, { role: 'user', content: input }]
  const content = await provider.complete(messages, options)
  return [...messages, { role: 'assistant', content }]
}
