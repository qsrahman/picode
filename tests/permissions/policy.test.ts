import { describe, expect, it } from 'vitest'

import { defaultPermission, type Permission } from '../../src/config/schema.ts'
import type { ToolCall } from '../../src/tools/types.ts'
import { ApprovalCache, denyReason, evaluateCall, toolsetForModel } from '../../src/permissions/policy.ts'
import { ToolRegistry } from '../../src/tools/registry.ts'
import { createShellTool } from '../../src/tools/shell.ts'

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { callId: 'c1', name, args }
}

function withRules(rules: Partial<Permission>): Permission {
  return { ...defaultPermission, ...rules }
}

function evalCall(c: ToolCall, rules: Permission, mode: 'interactive' | 'auto' | 'plan', isInteractive = true) {
  return evaluateCall({ call: c, rules, mode, isInteractive })
}

describe('evaluateCall — shell', () => {
  it('allows read-only commands without prompting', () => {
    expect(evalCall(call('run_command', { command: 'ls -F' }), defaultPermission, 'interactive')).toBe(
      'allow',
    )
  })

  it('prompts for unknown/non-read-only commands', () => {
    expect(
      evalCall(call('run_command', { command: 'npm install' }), defaultPermission, 'interactive'),
    ).toBe('ask')
  })

  it('forces a prompt on destructive commands even in auto mode', () => {
    expect(evalCall(call('run_command', { command: 'rm -rf /tmp' }), defaultPermission, 'auto')).toBe(
      'ask',
    )
  })

  it('denies destructive commands when a deny rule matches', () => {
    const rules = withRules({ shell: { allow: [], ask: [], deny: ['Bash(rm -rf *)'] } })
    expect(evalCall(call('run_command', { command: 'rm -rf /' }), rules, 'auto')).toBe('deny')
  })

  it('honors an ask rule, auto-approving it in auto mode', () => {
    const rules = withRules({ shell: { allow: [], ask: ['Bash(git *)'], deny: [] } })
    expect(evalCall(call('run_command', { command: 'git push' }), rules, 'interactive')).toBe('ask')
    expect(evalCall(call('run_command', { command: 'git push' }), rules, 'auto')).toBe('allow')
  })

  it('auto-denies a prompt when non-interactive', () => {
    expect(
      evalCall(call('run_command', { command: 'npm install' }), defaultPermission, 'interactive', false),
    ).toBe('deny')
  })
})

describe('evaluateCall — mode', () => {
  it('denies all writes in plan mode', () => {
    expect(evalCall(call('run_command', { command: 'ls' }), defaultPermission, 'plan')).toBe('allow')
    expect(evalCall(call('run_command', { command: 'rm -rf /' }), defaultPermission, 'plan')).toBe(
      'deny',
    )
  })

  it('treats an unmapped tool as a write (denied in plan)', () => {
    expect(evalCall(call('mystery_tool', {}), defaultPermission, 'plan')).toBe('deny')
    expect(evalCall(call('mystery_tool', {}), defaultPermission, 'interactive')).toBe('ask')
  })
})

describe('evaluateCall — read defaults', () => {
  it('blocks .env reads by default', () => {
    expect(evalCall(call('read_file', { path: '.env' }), defaultPermission, 'interactive')).toBe(
      'deny',
    )
  })

  it('allows other reads by default', () => {
    expect(evalCall(call('read_file', { path: 'src/a.ts' }), defaultPermission, 'interactive')).toBe(
      'allow',
    )
  })
})

describe('ApprovalCache', () => {
  it('upgrades an ask to allow once approved', () => {
    const rules = withRules({ shell: { allow: [], ask: ['Bash(git *)'], deny: [] } })
    const cache = new ApprovalCache()
    cache.add('Bash(git push)')
    expect(
      evaluateCall({
        call: call('run_command', { command: 'git push' }),
        rules,
        mode: 'interactive',
        isInteractive: false,
        approvals: cache,
      }),
    ).toBe('allow')
  })

  it('never overrides a deny rule', () => {
    const rules = withRules({ shell: { allow: [], ask: [], deny: ['Bash(rm -rf *)'] } })
    const cache = new ApprovalCache()
    cache.add('Bash(rm -rf /)')
    expect(evalCall(call('run_command', { command: 'rm -rf /' }), rules, 'interactive')).toBe('deny')
  })
})

describe('toolsetForModel', () => {
  it('hides tools the policy denies in the current mode', () => {
    const reg = new ToolRegistry()
    reg.register(createShellTool({ cwd: process.cwd(), timeout: 0 }))
    expect(toolsetForModel(reg, defaultPermission, 'auto').map((t) => t.name)).toContain('run_command')
    expect(toolsetForModel(reg, defaultPermission, 'plan').map((t) => t.name)).not.toContain('run_command')
  })
})

describe('denyReason', () => {
  it('names the firing deny rule', () => {
    const rules = { ...defaultPermission, shell: { allow: [], ask: [], deny: ['Bash(rm -rf *)'] } }
    expect(denyReason(call('run_command', { command: 'rm -rf /' }), rules, 'interactive')).toBe(
      'rule Bash(rm -rf *)',
    )
  })

  it('names plan mode for writes', () => {
    expect(denyReason(call('write_file', { path: 'a' }), defaultPermission, 'plan')).toBe(
      'plan mode (read-only)',
    )
  })

  it('returns undefined for a non-interactive ask denial', () => {
    expect(denyReason(call('run_command', { command: 'ls' }), defaultPermission, 'interactive')).toBeUndefined()
  })
})
