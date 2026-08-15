import OpenAI from 'openai'

import type { Config } from '../config/schema.ts'

export interface ProviderMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Provider {
  readonly model: string
  complete(input: ProviderMessage[], options?: { signal?: AbortSignal }): Promise<string>
}

// Isolates the OpenAI SDK from the agent loop so a second provider is one new
// file. The Responses API is stateless (store: false is the default here), so
// the caller owns the full conversation history.
export function createProvider(config: Config, apiKey: string): Provider {
  const client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    maxRetries: config.maxRetries,
  })

  return {
    model: config.model,
    async complete(input, options) {
      const response = await client.responses.create(
        {
          model: config.model,
          input,
          max_output_tokens: config.maxTokens,
          ...(config.instructions ? { instructions: config.instructions } : {}),
        },
        { signal: options?.signal },
      )
      return response.output_text
    },
  }
}
