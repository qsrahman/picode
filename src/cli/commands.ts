import type { Mode } from '../config/schema.ts'
import type { Decision } from '../permissions/rules.ts'

const MODES: Mode[] = ['interactive', 'auto', 'plan']

const DECISION_LABEL: Record<Decision, string> = {
  allow: 'allow',
  ask: 'ask',
  deny: 'deny',
}

export interface ToolStatus {
  name: string
  status: Decision
}

export interface CommandContext {
  print: (line: string) => void
  dim: (s: string) => string
  clearScreen: () => void
  resetConversation: () => void
  exit: () => void
  model: string
  mode: Mode
  setMode?: (mode: Mode) => void
  toolStatus?: () => ToolStatus[]
}

export function isCommand(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.length > 1 && trimmed.startsWith('/')
}

// Sorted alphabetically so /help output is predictable at a glance.
const COMMAND_HELP = `Commands:
  /clear   clear the terminal
  /exit    quit pcode
  /help    show this help
  /mode    show the current permission mode (or switch: /mode auto|plan)
  /model   show the active model
  /reset   reset the conversation
  /tools   list tools and their effective permission in the current mode

Run pcode --help for CLI flags and options.`

// Handles every line that looks like a slash command. Returns true when the
// line was consumed as a command (known or unknown), false for prose.
export function runCommand(input: string, ctx: CommandContext): boolean {
  const [name, ...rest] = input.trim().split(/\s+/)
  const cmd = name ?? ''
  const args = rest.join(' ')

  switch (cmd) {
    case '/help':
      ctx.print(ctx.dim(COMMAND_HELP))
      ctx.print('')
      return true
    case '/clear':
      ctx.clearScreen()
      return true
    case '/reset':
      ctx.resetConversation()
      ctx.print('conversation reset')
      return true
    case '/model':
      ctx.print(`model: ${ctx.model}`)
      ctx.print('')
      return true
    case '/mode':
      if (args !== '') {
        const next = MODES.find((m) => m === args)
        if (!next) {
          ctx.print(`unknown mode: ${args} (expected ${MODES.join(' | ')})`)
          return true
        }
        ctx.setMode?.(next)
        ctx.print(`mode: ${next}`)
        return true
      }
      ctx.print(`mode: ${ctx.mode}`)
      ctx.print('')
      return true
    case '/tools': {
      if (!ctx.toolStatus) {
        ctx.print('no tools registered')
        return true
      }
      for (const t of ctx.toolStatus()) {
        ctx.print(`${t.name.padEnd(16)} ${DECISION_LABEL[t.status]}`)
      }
      ctx.print('')
      return true
    }
    case '/exit':
      ctx.exit()
      return true
    default:
      if (args !== '') ctx.print(`unknown command: ${cmd} ${args}`)
      else ctx.print(`unknown command: ${cmd}`)
      ctx.print('type /help to list available commands')
      return true
  }
}
