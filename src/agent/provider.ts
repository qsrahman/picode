import OpenAI from 'openai'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import type { ResponseStream } from 'openai/lib/responses/ResponseStream'
import type { Config } from '../config/schema.ts'
import type { ToolDefinition } from '../tools/types.ts'

// Structural description of a Responses conversation item. The SDK's item
// types are too strict (and version-bound) to leak into the agent loop; the
// loop only ever reads the fields it cares about (role/type/call_id/name) and
// re-pushes items back opaquely, so loose optional fields keep a second
// provider possible.
export interface ProviderItem {
  role?: 'user' | 'assistant'
  content?: string
  type?: 'message' | 'function_call' | 'function_call_output'
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  output?: string
}

export type ProviderEvent = { type: 'text_delta'; delta: string }

export interface ProviderStream extends AsyncIterable<ProviderEvent> {
  finalOutput(): Promise<{ items: ProviderItem[]; text: string }>
}

export interface Provider {
  readonly model: string
  stream(
    input: ProviderItem[],
    options: { tools: ToolDefinition[]; signal?: AbortSignal },
  ): Promise<ProviderStream>
}

// Isolates the OpenAI SDK from the agent loop so a second provider is one new
// file. The Responses API is stateless (store: false is the default here), so
// the caller owns the full conversation history. Tool definitions are mapped
// into SDK shape here, keeping the provider-agnostic ToolDefinition free of
// OpenAI-only fields like `strict`.
export function createProvider(config: Config, apiKey: string): Provider {
  const client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    maxRetries: config.maxRetries,
  })

  return {
    model: config.model,
    async stream(input, options) {
      const stream = client.responses.stream(
        {
          model: config.model,
          input: input as unknown as ResponseInputItem[],
          max_output_tokens: config.maxTokens,
          tools:
            options.tools.length > 0
              ? options.tools.map((tool) => ({
                  type: 'function' as const,
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                  strict: false,
                }))
              : undefined,
          ...(config.instructions ? { instructions: config.instructions } : {}),
        },
        { signal: options.signal },
      )
      return {
        [Symbol.asyncIterator]: () => streamEvents(stream)[Symbol.asyncIterator](),
        finalOutput: async () => {
          const response = await stream.finalResponse()
          return {
            items: response.output as unknown as ProviderItem[],
            text: response.output_text,
          }
        },
      }
    },
  }
}

async function* streamEvents(stream: ResponseStream): AsyncGenerator<ProviderEvent> {
  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      yield { type: 'text_delta', delta: event.delta }
    }
  }
}
