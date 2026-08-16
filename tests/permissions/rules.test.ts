import { describe, expect, it } from 'vitest'

import { defaultPermission, type Permission } from '../../src/config/schema.ts'
import {
  combineDecisions,
  evaluatePattern,
  matchGlob,
  matchPathGlob,
  parseToolPattern,
  splitCommand,
} from '../../src/permissions/rules.ts'

function withRules(rules: Partial<Permission>): Permission {
  return { ...defaultPermission, ...rules }
}

describe('parseToolPattern', () => {
  it('parses the five configured categories', () => {
    expect(parseToolPattern('Bash(pnpm test)')).toEqual({ kind: 'shell', operand: 'pnpm test' })
    expect(parseToolPattern('Edit(src/a.ts)')).toEqual({ kind: 'edit', operand: 'src/a.ts' })
    expect(parseToolPattern('Read(.env)')).toEqual({ kind: 'read', operand: '.env' })
    expect(parseToolPattern('WebSearch(picode agent)')).toEqual({
      kind: 'webSearch',
      operand: 'picode agent',
    })
    expect(parseToolPattern('WebFetch(https://example.com)')).toEqual({
      kind: 'webFetch',
      operand: 'https://example.com',
    })
  })

  it('rejects malformed or unknown patterns', () => {
    expect(parseToolPattern('not-a-pattern')).toBeNull()
    expect(parseToolPattern('Bash')).toBeNull()
    expect(parseToolPattern('Weird(x)')).toBeNull()
  })
})

describe('glob matching', () => {
  it('matches wildcards for commands', () => {
    expect(matchGlob('pnpm test *', 'pnpm test foo bar')).toBe(true)
    expect(matchGlob('rm -rf *', 'rm -rf /tmp')).toBe(true)
    expect(matchGlob('pnpm *', 'npm install')).toBe(false)
  })

  it('treats * as a single path segment but ** crosses segments', () => {
    expect(matchPathGlob('src/*', 'src/a.ts')).toBe(true)
    expect(matchPathGlob('src/*', 'src/a/b.ts')).toBe(false)
    expect(matchPathGlob('src/**', 'src/a/b.ts')).toBe(true)
    expect(matchPathGlob('*.env', 'config/.env')).toBe(false)
  })

  it('crosses slashes for a bare * on WebFetch patterns, like Bash', () => {
    expect(matchGlob('https://docs.example.com/*', 'https://docs.example.com/a/b')).toBe(true)
  })
})

describe('evaluatePattern precedence', () => {
  it('returns allow when only an allow rule matches', () => {
    const rules = withRules({ shell: { allow: ['Bash(pnpm test *)'], ask: [], deny: [] } })
    expect(evaluatePattern('Bash(pnpm test unit)', rules)).toBe('allow')
  })

  it('returns ask when only an ask rule matches', () => {
    const rules = withRules({ shell: { allow: [], ask: ['Bash(git *)'], deny: [] } })
    expect(evaluatePattern('Bash(git push)', rules)).toBe('ask')
  })

  it('returns deny when only a deny rule matches', () => {
    const rules = withRules({ shell: { allow: [], ask: [], deny: ['Bash(rm -rf *)'] } })
    expect(evaluatePattern('Bash(rm -rf /)', rules)).toBe('deny')
  })

  it('honors deny > ask > allow independent of order', () => {
    const denyAndAllow = withRules({
      shell: { allow: ['Bash(rm -rf *)'], ask: [], deny: ['Bash(rm -rf *)'] },
    })
    expect(evaluatePattern('Bash(rm -rf /)', denyAndAllow)).toBe('deny')
    const askAndAllow = withRules({
      shell: { allow: ['Bash(git *)'], ask: ['Bash(git *)'], deny: [] },
    })
    expect(evaluatePattern('Bash(git push)', askAndAllow)).toBe('ask')
  })

  it('returns null when nothing matches', () => {
    expect(evaluatePattern('Bash(unknown)', defaultPermission)).toBeNull()
  })

  it('matches the right category only', () => {
    const rules = withRules({ shell: { allow: ['Bash(*)'], ask: [], deny: [] } })
    expect(evaluatePattern('Edit(src/x)', rules)).toBeNull()
  })

  it('matches WebFetch patterns using crossSlash globs', () => {
    const rules = withRules({
      webFetch: { allow: [], ask: [], deny: ['WebFetch(https://internal.corp/**)'] },
    })
    expect(evaluatePattern('WebFetch(https://internal.corp/secrets)', rules)).toBe('deny')
    expect(evaluatePattern('WebFetch(https://example.com)', rules)).toBeNull()
  })

  it('keeps webSearch and webFetch as distinct categories', () => {
    const rules = withRules({ webSearch: { allow: ['WebSearch(*)'], ask: [], deny: [] } })
    expect(evaluatePattern('WebSearch(anything)', rules)).toBe('allow')
    expect(evaluatePattern('WebFetch(https://example.com)', rules)).toBeNull()
  })
})

describe('splitCommand', () => {
  it('splits on &&, ||, ; and |', () => {
    expect(splitCommand('ls && echo hi || cat a')).toEqual(['ls', 'echo hi', 'cat a'])
    expect(splitCommand('a; b | c')).toEqual(['a', 'b', 'c'])
  })

  it('strips wrappers', () => {
    expect(splitCommand('sudo rm -rf x')).toEqual(['rm -rf x'])
    expect(splitCommand('timeout 10 ls -F')).toEqual(['ls -F'])
    expect(splitCommand('FOO=bar nohup bash run')).toEqual(['bash run'])
  })
})

describe('combineDecisions', () => {
  it('applies deny > ask > allow across subcommands', () => {
    expect(combineDecisions(['allow', 'allow'])).toBe('allow')
    expect(combineDecisions(['allow', 'ask'])).toBe('ask')
    expect(combineDecisions(['ask', 'deny'])).toBe('deny')
    expect(combineDecisions(['allow', null, 'ask'])).toBe('ask')
    expect(combineDecisions([null, null])).toBeNull()
  })
})
