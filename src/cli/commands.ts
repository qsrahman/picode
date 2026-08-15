import type { Mode } from '../config/schema.ts'

export interface SlashContext {
  print: (line: string) => void
  clearHistory: () => void
  exit: () => void
  model: string
  mode: Mode
}

export function isSlashCommand(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.length > 1 && trimmed.startsWith('/')
}

const SLASH_HELP = `Slash commands:
  /help    show this help
  /model   show the active model
  /mode    show the current permission mode
  /clear   reset the conversation
  /exit    quit pcode

Run pcode --help for CLI flags and options.`

// Handles every line that looks like a slash command. Returns true when the
// line was consumed as a command (known or unknown), false for prose.
export function runSlashCommand(input: string, ctx: SlashContext): boolean {
  const [name, ...rest] = input.trim().split(/\s+/)
  const cmd = name ?? ''
  const args = rest.join(' ')

  switch (cmd) {
    case '/help':
      ctx.print(SLASH_HELP)
      return true
    case '/clear':
      ctx.clearHistory()
      ctx.print('conversation cleared')
      return true
    case '/model':
      ctx.print(`model: ${ctx.model}`)
      return true
    case '/mode':
      ctx.print(`mode: ${ctx.mode}`)
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
