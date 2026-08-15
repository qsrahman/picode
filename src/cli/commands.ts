import type { Mode } from '../config/schema.ts'

export interface SlashContext {
  print: (line: string) => void
  dim: (s: string) => string
  clearScreen: () => void
  resetConversation: () => void
  exit: () => void
  model: string
  mode: Mode
}

export function isSlashCommand(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.length > 1 && trimmed.startsWith('/')
}

// Sorted alphabetically so /help output is predictable at a glance.
const SLASH_HELP = `Commands:
  /clear   clear the terminal
  /exit    quit pcode
  /help    show this help
  /model   show the active model
  /mode    show the current permission mode
  /reset   reset the conversation

Run pcode --help for CLI flags and options.`

// Handles every line that looks like a slash command. Returns true when the
// line was consumed as a command (known or unknown), false for prose.
export function runSlashCommand(input: string, ctx: SlashContext): boolean {
  const [name, ...rest] = input.trim().split(/\s+/)
  const cmd = name ?? ''
  const args = rest.join(' ')

  switch (cmd) {
    case '/help':
      ctx.print(ctx.dim(SLASH_HELP))
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
      ctx.print(`mode: ${ctx.mode}`)
      ctx.print('')
      return true
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
