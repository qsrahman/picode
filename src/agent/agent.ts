import type { Provider, ProviderItem } from './provider.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { ToolCall, ToolDescriptor } from '../tools/types.ts'

export const MAX_TOOL_ROUNDS = 8

export interface RunOptions {
  controller?: AbortController
  tools?: ToolDescriptor[]
  registry?: ToolRegistry
  // Gates every tool call. Phase 3 swaps this for the rule engine; a missing
  // hook (or a non-interactive caller that omits it) denies nothing, so the
  // loop's tool execution is a no-op without an explicit registry + hook.
  requestApproval?: (call: ToolCall) => Promise<boolean>
  onText?: (delta: string) => void
}

export interface TurnResult {
  items: ProviderItem[]
  text: string
  truncated: boolean
}

// One model turn with up to MAX_TOOL_ROUNDS tool rounds. There is no
// sendFunctionCallOutputs helper in this SDK version, so each round streams
// the accumulated items, extracts function_call items from the response
// output, executes them, appends function_call_output items (D5), and re-runs.
export async function runTurn(
  provider: Provider,
  history: ProviderItem[],
  input: string,
  options: RunOptions = {},
): Promise<TurnResult> {
  const items: ProviderItem[] = [...history, { role: 'user', content: input }]
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await provider.stream(items, {
      tools: options.tools ?? [],
      signal: options.controller?.signal,
    })
    for await (const event of stream) {
      if (event.type === 'text_delta') options.onText?.(event.delta)
    }
    const final = await stream.finalOutput()
    const calls = extractFunctionCalls(final.items)
    if (calls.length === 0) {
      return { items: [...items, ...final.items], text: final.text, truncated: false }
    }
    items.push(...final.items)
    for (const call of calls) {
      let output: string
      if (options.requestApproval && !(await options.requestApproval(call))) {
        output = 'tool call denied by user'
      } else if (options.registry) {
        output = (await options.registry.execute(call)).output
      } else {
        output = 'error: tool not available'
      }
      items.push({ type: 'function_call_output', call_id: call.callId, output })
    }
  }
  return { items, text: '', truncated: true }
}

function extractFunctionCalls(items: ProviderItem[]): ToolCall[] {
  const calls: ToolCall[] = []
  for (const item of items) {
    if (item.type !== 'function_call' || item.call_id === undefined || item.name === undefined)
      continue
    let args: Record<string, unknown> = {}
    if (item.arguments !== undefined) {
      try {
        const parsed: unknown = JSON.parse(item.arguments)
        if (isRecord(parsed)) args = parsed
      } catch {
        // Leave {} so the registry's argument validation reports the error.
      }
    }
    calls.push({ callId: item.call_id, name: item.name, args })
  }
  return calls
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
