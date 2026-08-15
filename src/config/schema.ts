import { z } from 'zod'

export const modes = ['interactive', 'auto', 'plan'] as const
export const modeSchema = z.enum(modes)
export type Mode = z.infer<typeof modeSchema>

// All fields are required: defaults are merged in config.ts before parsing, so
// a missing key is a programming error, not a user concern. Files are parsed
// with .partial() to tolerate a subset of keys.
export const configSchema = z.object({
  model: z.string().min(1),
  baseURL: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  instructions: z.string(),
  root: z.string().min(1),
  additionalDirs: z.array(z.string().min(1)),
  mode: modeSchema,
  maxTokens: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  toolTimeout: z.number().int().positive(),
})

export type Config = z.infer<typeof configSchema>
