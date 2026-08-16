import { describe, expect, it } from 'vitest'

import { defaultPermission } from '../../src/config/schema.ts'
import type { ToolCall } from '../../src/tools/types.ts'
import { ApprovalCache } from '../../src/permissions/policy.ts'
import { promptForDecision } from '../../src/permissions/prompt.ts'

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
