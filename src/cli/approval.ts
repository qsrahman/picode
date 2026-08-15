import type { ToolCall } from '../tools/types.ts'
import { runCommandName } from '../tools/shell.ts'

// Keyed by exact call arguments; approvals are session-only until Phase 5.
export function approvalKey(call: ToolCall): string {
  return `${call.name}(${JSON.stringify(call.args)})`
}

export function summaryOf(call: ToolCall, verbose: boolean): string {
  if (call.name === runCommandName && typeof call.args.command === 'string') {
    const command = call.args.command
    const max = verbose ? Infinity : 80
    const shown = command.length > max ? `${command.slice(0, max)}…` : command
    return `shell: ${shown}`
  }
  return `${call.name}(${JSON.stringify(call.args)})`
}

// Maps the interactive answer to a decision, mutating the session-approval set
// so later calls with identical arguments skip the prompt.
export function applyApprovalAnswer(
  answer: string,
  key: string,
  sessionApprovals: Set<string>,
): boolean {
  if (answer === 'a') sessionApprovals.add(key)
  return answer === 'y' || answer === 'a'
}
