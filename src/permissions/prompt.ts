import type { Permission } from '../config/schema.ts'
import type { ToolCall } from '../tools/types.ts'
import { ApprovalCache, classifyCall } from './policy.ts'
import { matchRuleInList, parseToolPattern } from './rules.ts'
import { summaryOf } from '../cli/approval.ts'

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

// Interactive y/n/a prompt for an `ask` decision. Shows the tool, the matching
// rule (so the user sees why it's gated), and the exact pattern an "always"
// answer will record. Records approvals into the session cache.
export async function promptForDecision(opts: {
  call: ToolCall
  rules: Permission
  approvals: ApprovalCache
  io: PromptIO
  dim?: (s: string) => string
}): Promise<ApprovalOutcome> {
  const { call, rules, approvals, io, dim } = opts
  const patterns = classifyCall(call)?.patterns ?? [`Unknown(${call.name})`]
  const rule =
    patterns
      .map((p) => {
        const kind = parseToolPattern(p)?.kind
        return kind ? matchRuleInList(p, rules[kind].ask) : null
      })
      .find(Boolean) ?? null

  const label = dim ? dim(summaryOf(call, false)) : summaryOf(call, false)
  io.print(label)
  io.print(`  Run? (y/n/a)${rule ? `  [rule: ${rule}]` : ''}`)
  io.print(`  'a' approves: ${patterns.join(', ')}`)

  const answer = (await io.question('')).trim().toLowerCase()
  if (answer === 'a') {
    for (const p of patterns) approvals.add(p)
    return { allow: true, approvedPatterns: patterns }
  }
  return { allow: answer === 'y', approvedPatterns: [] }
}
