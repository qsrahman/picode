import type { Permission } from '../config/schema.ts'
import type { Mode } from '../config/schema.ts'
import type { ToolCall } from '../tools/types.ts'
import { runCommandName } from '../tools/shell.ts'
import { ApprovalCache, classifyCall, evaluateCall } from './policy.ts'
import { matchRuleInList, parseToolPattern, type Decision } from './rules.ts'

// One-line tool label for status lines and the approval prompt.
export function summaryOf(call: ToolCall, verbose: boolean): string {
  if (call.name === runCommandName && typeof call.args.command === 'string') {
    const command = call.args.command
    const max = verbose ? Infinity : 80
    const shown = command.length > max ? `${command.slice(0, max)}…` : command
    return `shell: ${shown}`
  }
  if (call.name === 'web_search' && typeof call.args.query === 'string') {
    return `web_search: ${call.args.query}`
  }
  if (call.name === 'web_fetch' && typeof call.args.url === 'string') {
    return `web_fetch: ${call.args.url}`
  }
  return `${call.name}(${JSON.stringify(call.args)})`
}

export interface PromptIO {
  print: (line: string) => void
  // Resolves with the user's raw answer line; the REPL backs this with its
  // input capture so the prompt pauses the session instead of spawning a tty.
  question: (prompt: string) => Promise<string>
}

export interface ApprovalOutcome {
  allow: boolean
  // Patterns recorded when the user chose "always" (session-only).
  approvedPatterns: string[]
}

// Interactive y/n/a prompt for an `ask` decision. Shows the matching rule (so
// the user sees why it's gated) and the exact pattern an "always" answer will
// record — not the tool summary itself, which the caller's status line
// already shows above this. Records approvals into the session cache.
export async function promptForDecision(opts: {
  call: ToolCall
  rules: Permission
  approvals: ApprovalCache
  io: PromptIO
}): Promise<ApprovalOutcome> {
  const { call, rules, approvals, io } = opts
  const patterns = classifyCall(call)?.patterns ?? [`Unknown(${call.name})`]
  const rule =
    patterns
      .map((p) => {
        const kind = parseToolPattern(p)?.kind
        return kind ? matchRuleInList(p, rules[kind].ask) : null
      })
      .find(Boolean) ?? null

  io.print(`  Run? (y/n/a)${rule ? `  [rule: ${rule}]` : ''}`)
  io.print(`  'a' approves: ${patterns.join(', ')}`)

  const answer = (await io.question('')).trim().toLowerCase()
  if (answer === 'a') {
    for (const p of patterns) approvals.add(p)
    return { allow: true, approvedPatterns: patterns }
  }
  return { allow: answer === 'y', approvedPatterns: [] }
}

export interface AuthorizerIO {
  interactive: boolean
  question: (prompt: string) => Promise<string>
  print: (line: string) => void
}

// Compose the policy engine + prompt into the boolean gate the agent loop
// expects. Callers inject IO: the REPL backs `question` with its input capture
// and wraps it in status-line pause/resume; one-shot passes a non-interactive
// IO so `ask` decisions resolve to a denial.
export function createAuthorizer(opts: {
  rules: Permission
  mode: Mode
  approvals: ApprovalCache
  io: AuthorizerIO
}): (call: ToolCall) => Promise<boolean> {
  return async (call) => {
    const decision: Decision = evaluateCall({
      call,
      rules: opts.rules,
      mode: opts.mode,
      isInteractive: opts.io.interactive,
      approvals: opts.approvals,
    })
    if (decision === 'allow') return true
    if (decision === 'deny') return false
    const outcome = await promptForDecision({
      call,
      rules: opts.rules,
      approvals: opts.approvals,
      io: { print: opts.io.print, question: opts.io.question },
    })
    return outcome.allow
  }
}
