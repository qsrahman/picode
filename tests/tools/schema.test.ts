import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { zodToJsonSchema } from '../../src/tools/schema.ts'

describe('zodToJsonSchema', () => {
  it('converts primitives', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' })
    expect(zodToJsonSchema(z.number())).toEqual({ type: 'number' })
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' })
  })

  it('converts enums and literals', () => {
    expect(zodToJsonSchema(z.enum(['a', 'b']))).toEqual({ type: 'string', enum: ['a', 'b'] })
    expect(zodToJsonSchema(z.literal('x'))).toEqual({ type: 'string', const: 'x' })
  })

  it('converts arrays', () => {
    expect(zodToJsonSchema(z.array(z.string()))).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
  })

  it('marks required properties and forbids extras', () => {
    const schema = z.object({ command: z.string(), cwd: z.string().optional() })
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    })
  })

  it('handles nested objects and arrays', () => {
    const schema = z.object({ env: z.object({ path: z.string() }), tags: z.array(z.string()) })
    expect(zodToJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        env: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['env', 'tags'],
      additionalProperties: false,
    })
  })

  it('throws on unsupported kinds', () => {
    expect(() => zodToJsonSchema(z.date())).toThrow(/unsupported/)
  })
})
