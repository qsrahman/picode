import type { Provider, ProviderItem } from './provider.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types.ts'

export const MAX_TOOL_ROUNDS = 8

export interface RunOptions {
  controller?: AbortController
  tools?: ToolDefinition[]
  registry?: ToolRegistry
  // Gates every tool call. Backed by the permission engine (permissions/):
  // the caller composes policy + prompt into this boolean gate, so the loop
  // stays free of permission/rules details. Missing hook → execute (the
  // caller is expected to always supply one in real runs).
  authorize?: (call: ToolCall) => Promise<boolean>
  // Status-line sink: called once per executed call so the CLI can settle a
  // running status line with ✓/✗ and the elapsed time.
  onToolResult?: (call: ToolCall, result: ToolResult, ms: number) => void
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
      if (options.authorize && !(await options.authorize(call))) {
        output = 'tool call denied'
      } else if (options.registry) {
        const started = Date.now()
        const result = await options.registry.execute(call)
        if (options.onToolResult) options.onToolResult(call, result, Date.now() - started)
        output = result.output
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
