import type { z } from 'zod'

// A tool is pure execution: name/description for the model, a zod schema to
// validate model-provided arguments, and an execute() that returns the text
// handed back to the model. Approval, status lines, and policy live in the
// agent loop, never here.
export interface Tool {
  name: string
  description: string
  input: z.ZodTypeAny
  execute(args: unknown): Promise<string>
}

// The Responses API correlates each function_call_output with the call's id.
export interface ToolCall {
  callId: string
  name: string
  args: Record<string, unknown>
}

// output is always a string: tool stdout, or an error/denial message the model
// should read and react to.
export interface ToolResult {
  callId: string
  name: string
  output: string
}

export interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}
