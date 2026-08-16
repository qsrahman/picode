import type { Mode, Permission } from '../config/schema.ts'
import type { ToolCall, ToolDefinition } from '../tools/types.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { destructiveBreaker } from './breaker.ts'
import { isReadonlyCommand } from './readonly.ts'
import {
  combineDecisions,
  evaluatePattern,
  matchRuleInList,
  parseToolPattern,
  splitCommand,
  type Decision,
} from './rules.ts'

// Tool name → permission category + the args key holding the operand. Populated
// as tools land: `run_command` now; fs/git tools extend it in their slice. An
// unmapped tool is treated as a write (denied in plan, asked otherwise).
const TOOL_META: Record<string, { category: 'shell' | 'edit' | 'read'; key: string }> = {
  run_command: { category: 'shell', key: 'command' },
  // fs/git tools (slice H) register here so policy has a stable contract to
  // classify against; their implementations must use these exact names/keys.
  write_file: { category: 'edit', key: 'path' },
  read_file: { category: 'read', key: 'path' },
  list_dir: { category: 'read', key: 'path' },
  stat: { category: 'read', key: 'path' },
  git_status: { category: 'read', key: 'path' },
  git_diff: { category: 'read', key: 'path' },
  git_log: { category: 'read', key: 'path' },
  git_show: { category: 'read', key: 'path' },
}

const SHELL_BREAKERS = [destructiveBreaker, (cmd: string) => /\bsudo\b|\bsu\s/.test(cmd)]

// Session-only approvals recorded by the prompt ('a' answer). A pattern added
// here resolves to `allow` unless a deny rule matches a different pattern.
export class ApprovalCache {
  private approved = new Set<string>()
  add(pattern: string): void {
    this.approved.add(pattern)
  }
  has(pattern: string): boolean {
    return this.approved.has(pattern)
  }
  clear(): void {
    this.approved.clear()
  }
}

export interface EvaluateOptions {
  call: ToolCall
  rules: Permission
  mode: Mode
  isInteractive: boolean
  approvals?: ApprovalCache
}

export function classifyCall(
  call: ToolCall,
): { category: 'shell' | 'edit' | 'read'; patterns: string[] } | null {
  const meta = TOOL_META[call.name]
  if (!meta) return null
  const operand = typeof call.args[meta.key] === 'string' ? (call.args[meta.key] as string) : ''
  if (meta.category === 'shell') {
    return { category: 'shell', patterns: splitCommand(operand).map((sub) => `Bash(${sub})`) }
  }
  const prefix = meta.category === 'edit' ? 'Edit' : 'Read'
  return { category: meta.category, patterns: [`${prefix}(${operand})`] }
}

// Default decision when no rule matched: reads are allowed (except `.env*`),
// shell read-only commands are allowed, everything else is asked.
function defaultDecision(category: 'shell' | 'edit' | 'read', patterns: string[]): Decision {
  if (category === 'read') {
    const blocked = patterns.some((p) => {
      const op = parseToolPattern(p)?.operand ?? ''
      return op === '.env' || op.endsWith('.env') || op.endsWith('/.env')
    })
    return blocked ? 'deny' : 'allow'
  }
  if (category === 'shell') {
    const command =
      typeof patterns[0] === 'string' ? (parseToolPattern(patterns[0])?.operand ?? '') : ''
    return isReadonlyCommand(command) ? 'allow' : 'ask'
  }
  return 'ask'
}

function finalize(
  decision: Decision,
  mode: Mode,
  isInteractive: boolean,
  category: 'shell' | 'edit' | 'read',
  breakerForced: boolean,
  command: string,
): Decision {
  if (decision === 'deny') return 'deny'
  if (mode === 'plan') {
    if (category === 'edit') return 'deny'
    if (category === 'shell') return isReadonlyCommand(command) ? 'allow' : 'deny'
    return 'allow'
  }
  if (mode === 'auto') return breakerForced ? 'ask' : 'allow'
  // interactive: an explicit allow (rule, read-only default, or approval) is
  // honored even when non-interactive; only an unresolved `ask` auto-denies.
  if (decision === 'allow') return 'allow'
  if (!isInteractive) return 'deny'
  return decision
}

export function evaluateCall(opts: EvaluateOptions): Decision {
  const classified = classifyCall(opts.call)
  // Unmapped tool: deny in plan, otherwise ask (gated).
  const category: 'shell' | 'edit' | 'read' = classified?.category ?? 'edit'
  const patterns = classified?.patterns ?? []

  const command = typeof opts.call.args.command === 'string' ? opts.call.args.command : ''

  const decision = combineDecisions(
    patterns.map((p) => (opts.approvals?.has(p) ? 'allow' : evaluatePattern(p, opts.rules))),
  )

  let result: Decision | null = decision
  let breakerForced = false
  if (category === 'shell' && SHELL_BREAKERS.some((b) => b(command))) {
    if (result !== 'deny') {
      result = 'ask'
      breakerForced = true
    }
  } else if (result === null) {
    result = defaultDecision(category, patterns)
  }

  return finalize(result ?? 'deny', opts.mode, opts.isInteractive, category, breakerForced, command)
}

// Short human-readable reason a call was denied, for status-line feedback: the
// firing deny rule, or the read-only plan-mode constraint. Returns undefined
// when the denial is just an unresolved `ask` in a non-interactive run.
export function denyReason(call: ToolCall, rules: Permission, mode: Mode): string | undefined {
  const classified = classifyCall(call)
  const category = classified?.category ?? 'edit'
  const patterns = classified?.patterns ?? []
  for (const p of patterns) {
    const rule = matchRuleInList(p, rules[category].deny)
    if (rule) return `rule ${rule}`
  }
  if (mode === 'plan' && (category === 'shell' || category === 'edit')) {
    return 'plan mode (read-only)'
  }
  return undefined
}

// Tools the policy would always deny in the current mode are hidden from the
// model's toolset; everything else stays visible (the loop's authorize() is the
// hard backstop for calls that are denied only for specific arguments).
export function toolsetForModel(
  registry: ToolRegistry,
  rules: Permission,
  mode: Mode,
): ToolDefinition[] {
  return registry.descriptors().filter((tool) => {
    const decision = evaluateCall({
      call: { callId: '', name: tool.name, args: {} },
      rules,
      mode,
      isInteractive: true,
    })
    return decision !== 'deny'
  })
}
