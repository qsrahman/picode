import type { Mode, Permission } from '../config/schema.ts'
import type { ToolCall, ToolDefinition } from '../tools/types.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import { shellBreakers } from './breaker.ts'
import { isReadonlyCommand } from './readonly.ts'
import {
  combineDecisions,
  evaluatePattern,
  matchRuleInList,
  parseToolPattern,
  splitCommand,
  type Decision,
} from './rules.ts'

type Category = 'shell' | 'edit' | 'read' | 'webSearch' | 'webFetch' | 'agent' | 'todo'

// Tool name → permission category + the args key holding the operand. Populated
// as tools land: `run_command` now; fs/git tools extend it in their slice. An
// unmapped tool is treated as a write (denied in plan, asked otherwise).
const TOOL_META: Record<string, { category: Category; key: string }> = {
  run_command: { category: 'shell', key: 'command' },
  // fs/git tools (slice H) register here so policy has a stable contract to
  // classify against; their implementations must use these exact names/keys.
  write_file: { category: 'edit', key: 'path' },
  edit_file: { category: 'edit', key: 'path' },
  read_file: { category: 'read', key: 'path' },
  list_dir: { category: 'read', key: 'path' },
  stat: { category: 'read', key: 'path' },
  // git tools take no path-shaped arg, so `key` never resolves to an operand
  // and classifyCall always produces `Read()`. That's intentional: it makes
  // git reads unconditionally allowed by the read-category default (nothing
  // can equal the `.env` deny check) and un-targetable by a Read(...) rule.
  git_status: { category: 'read', key: '' },
  git_diff: { category: 'read', key: '' },
  git_log: { category: 'read', key: '' },
  git_show: { category: 'read', key: '' },
  web_search: { category: 'webSearch', key: 'query' },
  web_fetch: { category: 'webFetch', key: 'url' },
  run_agent: { category: 'agent', key: 'description' },
  // todo only mutates session state, never the workspace, so it defaults to
  // allow (like read) and is allowed in plan mode; a deny rule can still block it.
  todo: { category: 'todo', key: 'action' },
}

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

const PATTERN_PREFIX: Record<Category, string> = {
  shell: 'Bash',
  edit: 'Edit',
  read: 'Read',
  webSearch: 'WebSearch',
  webFetch: 'WebFetch',
  agent: 'Agent',
  todo: 'Todo',
}

export function classifyCall(call: ToolCall): { category: Category; patterns: string[] } | null {
  const meta = TOOL_META[call.name]
  if (!meta) return null
  const operand = typeof call.args[meta.key] === 'string' ? (call.args[meta.key] as string) : ''
  if (meta.category === 'shell') {
    return { category: 'shell', patterns: splitCommand(operand).map((sub) => `Bash(${sub})`) }
  }
  return { category: meta.category, patterns: [`${PATTERN_PREFIX[meta.category]}(${operand})`] }
}

// Default decision when no rule matched: reads are allowed (except `.env*`),
// shell commands are allowed only when every subcommand is read-only,
// webSearch/webFetch always ask (no readonly-style allowlist for arbitrary
// network egress), and everything else is asked. A compound shell line is
// classified by its most privileged subcommand, so a benign prefix can't
// launder a destructive one.
function defaultDecision(category: Category, patterns: string[]): Decision {
  if (category === 'todo') return 'allow'
  if (category === 'read') {
    const blocked = patterns.some((p) => (parseToolPattern(p)?.operand ?? '').endsWith('.env'))
    return blocked ? 'deny' : 'allow'
  }
  if (category === 'shell') {
    const allReadonly = patterns.every((p) => isReadonlyCommand(parseToolPattern(p)?.operand ?? ''))
    return allReadonly ? 'allow' : 'ask'
  }
  return 'ask'
}

function finalize(
  decision: Decision,
  mode: Mode,
  isInteractive: boolean,
  category: Category,
  breakerForced: boolean,
  command: string,
): Decision {
  if (decision === 'deny') return 'deny'
  if (mode === 'plan') {
    // agent joins edit here: unlike read/webSearch/webFetch it isn't
    // non-mutating — a sub-agent can run shell commands or edit files through
    // its own inner tool calls, so plan mode must deny it outright.
    if (category === 'edit' || category === 'agent') return 'deny'
    if (category === 'shell') {
      const subs = splitCommand(command)
      return subs.length > 0 && subs.every((c) => isReadonlyCommand(c)) ? 'allow' : 'deny'
    }
    // read, webSearch, and webFetch are all non-mutating, so plan mode allows
    // them through like any other read (subject to an explicit deny rule,
    // handled above).
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
  const category: Category = classified?.category ?? 'edit'
  const patterns = classified?.patterns ?? []

  const command = typeof opts.call.args.command === 'string' ? opts.call.args.command : ''

  const decision = combineDecisions(
    patterns.map((p) => (opts.approvals?.has(p) ? 'allow' : evaluatePattern(p, opts.rules))),
  )

  let result: Decision | null = decision
  let breakerForced = false
  if (category === 'shell' && shellBreakers.some((b) => b(command))) {
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
  if (mode === 'plan' && (category === 'shell' || category === 'edit' || category === 'agent')) {
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
