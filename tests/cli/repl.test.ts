import { describe, expect, it } from 'vitest'

import { needsContinuation } from '../../src/cli/repl.ts'

describe('needsContinuation', () => {
  it('continues on a trailing backslash', () => {
    expect(needsContinuation('foo \\')).toBe(true)
    expect(needsContinuation('foo \\ ')).toBe(true)
  })

  it('continues on an unclosed brace', () => {
    expect(needsContinuation('if (x) {')).toBe(true)
    expect(needsContinuation('{ "a": 1')).toBe(true)
  })

  it('ignores braces inside strings', () => {
    expect(needsContinuation('const s = "{"')).toBe(false)
    expect(needsContinuation("const s = '{'")).toBe(false)
  })

  it('does not continue on balanced input', () => {
    expect(needsContinuation('function f() { return 1 }')).toBe(false)
    expect(needsContinuation('hello world')).toBe(false)
  })

  it('does not continue on an empty string', () => {
    expect(needsContinuation('')).toBe(false)
  })
})
