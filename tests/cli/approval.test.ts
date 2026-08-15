import { describe, expect, it } from 'vitest'

import { approvalKey, summaryOf, applyApprovalAnswer } from '../../src/cli/approval.ts'
import type { ToolCall } from '../../src/tools/types.ts'

describe('approval', () => {
  describe('approvalKey', () => {
    it('creates a key from name and args', () => {
      const call: ToolCall = { callId: 'c1', name: 'run', args: { cmd: 'ls' } }
      expect(approvalKey(call)).toBe('run({"cmd":"ls"})')
    })

    it('includes all args in the key', () => {
      const call: ToolCall = { callId: 'c1', name: 'run', args: { cmd: 'ls', dir: '/tmp' } }
      const key = approvalKey(call)
      expect(key).toContain('cmd')
      expect(key).toContain('ls')
      expect(key).toContain('dir')
      expect(key).toContain('/tmp')
    })

    it('differentiates calls with different args', () => {
      const call1: ToolCall = { callId: 'c1', name: 'run', args: { cmd: 'ls' } }
      const call2: ToolCall = { callId: 'c1', name: 'run', args: { cmd: 'ls -la' } }
      expect(approvalKey(call1)).not.toBe(approvalKey(call2))
    })
  })

  describe('summaryOf', () => {
    it('shows the command for shell calls', () => {
      const call: ToolCall = { callId: 'c1', name: 'run_command', args: { command: 'echo hello' } }
      expect(summaryOf(call, false)).toBe('shell: echo hello')
    })

    it('truncates long shell commands at 80 chars', () => {
      const longCmd = 'x'.repeat(100)
      const call: ToolCall = { callId: 'c1', name: 'run_command', args: { command: longCmd } }
      expect(summaryOf(call, false)).toBe(`shell: ${'x'.repeat(80)}…`)
    })

    it('does not truncate when verbose', () => {
      const longCmd = 'x'.repeat(100)
      const call: ToolCall = { callId: 'c1', name: 'run_command', args: { command: longCmd } }
      expect(summaryOf(call, true)).toBe(`shell: ${longCmd}`)
    })

    it('shows name and args for non-shell calls', () => {
      const call: ToolCall = { callId: 'c1', name: 'get_info', args: { path: '/foo' } }
      expect(summaryOf(call, false)).toContain('get_info')
    })
  })

  describe('applyApprovalAnswer', () => {
    it('adds to session on "a" answer', () => {
      const sessionApprovals = new Set<string>()
      const key = 'run({"cmd":"ls"})'

      applyApprovalAnswer('a', key, sessionApprovals)

      expect(sessionApprovals.has(key)).toBe(true)
    })

    it('returns true for "y" answer', () => {
      const sessionApprovals = new Set<string>()
      const result = applyApprovalAnswer('y', 'key', sessionApprovals)
      expect(result).toBe(true)
    })

    it('returns true for "a" answer', () => {
      const sessionApprovals = new Set<string>()
      const result = applyApprovalAnswer('a', 'key', sessionApprovals)
      expect(result).toBe(true)
    })

    it('returns false for "n" answer', () => {
      const sessionApprovals = new Set<string>()
      const result = applyApprovalAnswer('n', 'key', sessionApprovals)
      expect(result).toBe(false)
    })

    it('returns false for other answers', () => {
      const sessionApprovals = new Set<string>()
      const result = applyApprovalAnswer('maybe', 'key', sessionApprovals)
      expect(result).toBe(false)
    })
  })
})
