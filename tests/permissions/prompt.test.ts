import { describe, expect, it } from 'vitest'

import { defaultPermission } from '../../src/config/schema.ts'
import type { ToolCall } from '../../src/tools/types.ts'
import { ApprovalCache } from '../../src/permissions/policy.ts'
import { createAuthorizer, promptForDecision, summaryOf } from '../../src/permissions/prompt.ts'

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { callId: 'c1', name, args }
}

function fakeIo(answers: string[]) {
  const printed: string[] = []
  let i = 0
  return {
    printed,
    io: {
      print: (line: string) => printed.push(line),
      question: async () => answers[i++] ?? 'n',
    },
  }
}

describe('summaryOf', () => {
  it('labels shell commands, truncating past 80 chars unless verbose', () => {
    const short = call('run_command', { command: 'pnpm test' })
    expect(summaryOf(short, false)).toBe('shell: pnpm test')
    const long = call('run_command', { command: 'x'.repeat(100) })
    expect(summaryOf(long, false)).toBe(`shell: ${'x'.repeat(80)}…`)
    expect(summaryOf(long, true)).toBe(`shell: ${'x'.repeat(100)}`)
  })

  it('labels web and fs tools by their operand', () => {
    expect(summaryOf(call('web_search', { query: 'lisp history' }), false)).toBe(
      'web_search: lisp history',
    )
    expect(summaryOf(call('web_fetch', { url: 'https://example.com' }), false)).toBe(
      'web_fetch: https://example.com',
    )
    expect(summaryOf(call('edit_file', { path: 'src/index.ts' }), false)).toBe(
      'edit_file: src/index.ts',
    )
    expect(summaryOf(call('read_file', { path: 'tests/x.test.ts' }), false)).toBe(
      'read_file: tests/x.test.ts',
    )
    expect(summaryOf(call('list_dir', { path: '.' }), false)).toBe('list_dir: .')
    expect(summaryOf(call('stat', { path: 'src' }), false)).toBe('stat: src')
  })

  it('falls back to JSON args for unknown tools', () => {
    expect(summaryOf(call('todo_add', { text: 'hi' }), false)).toBe('todo_add({"text":"hi"})')
  })
})

describe('createAuthorizer', () => {
  it('allows/denies without prompting and only prompts on ask', async () => {
    const rules = {
      ...defaultPermission,
      shell: { allow: [], ask: ['Bash(git *)'], deny: ['Bash(rm -rf *)'] },
    }
    const interactive = createAuthorizer({
      rules,
      mode: 'interactive',
      approvals: new ApprovalCache(),
      io: { interactive: true, question: async () => 'y', print: () => {} },
    })
    expect(await interactive(call('run_command', { command: 'ls' }))).toBe(true)
    expect(await interactive(call('run_command', { command: 'rm -rf /' }))).toBe(false)
    expect(await interactive(call('run_command', { command: 'git push' }))).toBe(true)

    // Non-interactive: an unresolved `ask` resolves to a denial.
    const nonInteractive = createAuthorizer({
      rules,
      mode: 'interactive',
      approvals: new ApprovalCache(),
      io: { interactive: false, question: async () => 'y', print: () => {} },
    })
    expect(await nonInteractive(call('run_command', { command: 'git push' }))).toBe(false)
  })
})

describe('promptForDecision', () => {
  it('denies on n', async () => {
    const { io } = fakeIo(['n'])
    const out = await promptForDecision({
      call: call('run_command', { command: 'ls' }),
      rules: defaultPermission,
      approvals: new ApprovalCache(),
      io,
    })
    expect(out.allow).toBe(false)
    expect(out.approvedPatterns).toEqual([])
  })

  it('allows on y and shows the gating rule', async () => {
    const { io, printed } = fakeIo(['y'])
    const rules = {
      ...defaultPermission,
      shell: { allow: [], ask: ['Bash(git *)'], deny: [] },
    }
    const out = await promptForDecision({
      call: call('run_command', { command: 'git push' }),
      rules,
      approvals: new ApprovalCache(),
      io,
    })
    expect(out.allow).toBe(true)
    expect(printed.some((l) => l.includes('[rule: Bash(git *)]'))).toBe(true)
  })

  it('records the call pattern on a (always)', async () => {
    const { io } = fakeIo(['a'])
    const approvals = new ApprovalCache()
    const out = await promptForDecision({
      call: call('run_command', { command: 'git push' }),
      rules: defaultPermission,
      approvals,
      io,
    })
    expect(out.allow).toBe(true)
    expect(out.approvedPatterns).toEqual(['Bash(git push)'])
    expect(approvals.has('Bash(git push)')).toBe(true)
  })

  it('previews the exact pattern that "always" records', async () => {
    const { io, printed } = fakeIo(['a'])
    await promptForDecision({
      call: call('run_command', { command: 'git push' }),
      rules: defaultPermission,
      approvals: new ApprovalCache(),
      io,
    })
    expect(printed.some((l) => l.includes("'a' approves: Bash(git push)"))).toBe(true)
  })
})
