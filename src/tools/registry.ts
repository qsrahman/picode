import type { z } from 'zod'

import type { Tool, ToolCall, ToolDescriptor, ToolResult } from './types.ts'
import { zodToJsonSchema } from './schema.ts'

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`duplicate tool name: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
    return this
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  // Shape accepted by responses.create({ tools }).
  descriptors(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.input),
    }))
  }

  // Toolset filtering: a registry restricted to the named tools, sharing the
  // same Tool instances. Nothing in Phase 2 consumes it yet; /tools and mode
  // gating will (Phase 3).
  filter(names: readonly string[]): ToolRegistry {
    const sub = new ToolRegistry()
    for (const name of names) {
      const tool = this.tools.get(name)
      if (tool) sub.tools.set(name, tool)
    }
    return sub
  }

  // Dispatch one call. Every failure mode — unknown tool, invalid arguments,
  // a thrown tool error — comes back as an output string so the model can
  // react; nothing escapes as an uncaught exception.
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      return { callId: call.callId, name: call.name, output: `unknown tool: ${call.name}` }
    }
    const parsed = tool.input.safeParse(call.args)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return {
        callId: call.callId,
        name: call.name,
        output: `invalid arguments for ${call.name}: ${issue ? issue.message : 'invalid'}`,
      }
    }
    try {
      const output = await tool.execute(parsed.data as z.infer<typeof tool.input>)
      return { callId: call.callId, name: call.name, output }
    } catch (err) {
      return {
        callId: call.callId,
        name: call.name,
        output: `${call.name} failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}
