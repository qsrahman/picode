import type { z } from 'zod'

// Minimal zod → strict JSON-Schema converter (D3). Only the shapes tools
// actually need are supported; anything else fails loudly at registration
// time rather than sending a half-baked schema to the model.
export type JsonSchema = Record<string, unknown>

// zod 4's public "classic" types are aliased ($ZodType, $ZodLooseShape) and
// don't expose the runtime structure, so read the private _def instead: it
// discriminates on a stable `type` string (verified against zod 4.4).
interface ZodDef {
  type: string
  innerType?: z.ZodTypeAny
  element?: z.ZodTypeAny
  entries?: Record<string, unknown>
  values?: unknown[]
  shape?: Record<string, z.ZodTypeAny>
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = schema._def as unknown as ZodDef
  switch (def.type) {
    case 'string':
      return { type: 'string' }
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'enum':
      return { type: 'string', enum: Object.keys(def.entries ?? {}) }
    case 'literal': {
      const value = def.values?.[0]
      const kind =
        typeof value === 'string' ? 'string' : typeof value === 'number' ? 'number' : 'boolean'
      return { type: kind, const: value }
    }
    case 'array':
      return { type: 'array', items: zodToJsonSchema(def.element!) }
    case 'optional':
    case 'nullable':
      return zodToJsonSchema(def.innerType!)
    case 'object': {
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        properties[key] = zodToJsonSchema(child)
        const childDef = child._def as unknown as ZodDef
        if (childDef.type !== 'optional') required.push(key)
      }
      return { type: 'object', properties, required, additionalProperties: false }
    }
    default:
      throw new Error(`unsupported zod schema kind for JSON-Schema: ${def.type}`)
  }
}
