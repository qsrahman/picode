import { z } from 'zod'

export const modes = ['interactive', 'auto', 'plan'] as const
export const modeSchema = z.enum(modes)
export type Mode = z.infer<typeof modeSchema>

// Permission rules are Claude-Code-style `Tool(pattern)` strings grouped per
// tool category. Precedence (deny > ask > allow) is resolved by the rule
// engine, not the schema, so the three lists are peers here.
const ruleList = z.array(z.string())
export const toolRulesSchema = z.object({
  allow: ruleList,
  ask: ruleList,
  deny: ruleList,
})
export type ToolRules = z.infer<typeof toolRulesSchema>

export const permissionSchema = z.object({
  shell: toolRulesSchema,
  edit: toolRulesSchema,
  read: toolRulesSchema,
  // webSearch/webFetch are separate categories (not one shared `web`) so a
  // rule can target one without also matching the other — they're different
  // tools with different risk profiles (a query string vs. an arbitrary URL).
  webSearch: toolRulesSchema,
  webFetch: toolRulesSchema,
  // A sub-agent can perform arbitrary writes/shell commands through its own
  // inner tool calls, so it gets its own category rather than reusing `edit`.
  agent: toolRulesSchema,
})
export type Permission = z.infer<typeof permissionSchema>

// Config files are parsed with a deep partial: a file may set just one category
// or just one rule list without wiping the defaults for the rest.
export const filePermissionSchema = z
  .object({
    shell: toolRulesSchema.partial().optional(),
    edit: toolRulesSchema.partial().optional(),
    read: toolRulesSchema.partial().optional(),
    webSearch: toolRulesSchema.partial().optional(),
    webFetch: toolRulesSchema.partial().optional(),
    agent: toolRulesSchema.partial().optional(),
  })
  .partial()
  .optional()
export const emptyToolRules: ToolRules = { allow: [], ask: [], deny: [] }
export const defaultPermission: Permission = {
  shell: emptyToolRules,
  edit: emptyToolRules,
  read: emptyToolRules,
  webSearch: emptyToolRules,
  webFetch: emptyToolRules,
  agent: emptyToolRules,
}

// All fields are required: defaults are merged in config.ts before parsing, so
// a missing key is a programming error, not a user concern. Files are parsed
// with fileConfigSchema (a deep partial) to tolerate a subset of keys.
export const configSchema = z.object({
  model: z.string().min(1),
  baseURL: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  braveSearchApiKeyEnv: z.string().min(1),
  instructions: z.string(),
  root: z.string().min(1),
  additionalDirs: z.array(z.string().min(1)),
  mode: modeSchema,
  permission: permissionSchema,
  maxTokens: z.number().int().positive(),
  maxRetries: z.number().int().min(0),
  toolTimeout: z.number().int().positive(),
})

export type Config = z.infer<typeof configSchema>

// Config files parse with a deep partial: a file may set a single category or
// even a single rule list without wiping the defaults for the rest.
export const fileConfigSchema = configSchema.partial().extend({ permission: filePermissionSchema })
