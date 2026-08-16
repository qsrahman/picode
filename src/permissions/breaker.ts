import { splitCommand } from './rules.ts'

// Circuit breakers flag calls that must be prompted even in auto/plan mode.
// They are best-effort heuristics, not a parser: a destructive or privilege
// escaping command is forced to `ask` rather than silently auto-approved.
export type Breaker = (command: string) => boolean

const DESTRUCTIVE =
  /\b(?:rm\s+-rf|rm\s+-fr|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+-R\s+0|format\s)\b/
const ESCAPING = /\b(?:sudo|su\s)\b/

export function destructiveBreaker(command: string): boolean {
  return DESTRUCTIVE.test(command)
}

export function escapingBreaker(command: string): boolean {
  return ESCAPING.test(command)
}

// Every sub-command of a compound line is checked, so a benign prefix can't
// launder a destructive one.
export const shellBreakers: Breaker[] = [
  (command) => splitCommand(command).some(destructiveBreaker),
  (command) => splitCommand(command).some(escapingBreaker),
]
