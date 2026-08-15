import * as readline from 'node:readline'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Config } from '../config/schema.ts'
import type { Provider, ProviderMessage } from '../agent/provider.ts'
import { runTurn } from '../agent/agent.ts'
import type { Palette } from '../output/palette.ts'
import { isSlashCommand, runSlashCommand } from './commands.ts'

export const HISTORY_SIZE = 1000

export interface ReplOptions {
  provider: Provider
  config: Config
  palette: Palette
  historyFile: string
}

// A submitted line continues onto the next prompt when it ends in a backslash
// or leaves braces unbalanced (strings are respected so "{" in prose stays a
// single line).
export function needsContinuation(pending: string): boolean {
  const trimmed = pending.trimEnd()
  if (trimmed.endsWith('\\')) return true
  return hasOpenBraces(trimmed)
}

function hasOpenBraces(text: string): boolean {
  let depth = 0
  let inString: "'" | '"' | '`' | null = null
  let escaped = false
  for (const ch of text) {
    if (inString !== null) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === inString) inString = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') inString = ch
    else if (ch === '{') depth++
    else if (ch === '}') depth--
  }
  return depth > 0
}

function loadHistory(path: string): string[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .slice(-HISTORY_SIZE)
  } catch {
    return []
  }
}

function saveHistory(path: string, entries: string[]): void {
  const capped = entries.slice(-HISTORY_SIZE)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, capped.length > 0 ? `${capped.join('\n')}\n` : '')
  } catch {
    // History persistence is best-effort; a read-only home should not break the REPL.
  }
}

export async function runRepl(opts: ReplOptions): Promise<void> {
  const { provider, config, palette } = opts
  const loaded = loadHistory(opts.historyFile)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    history: loaded,
    historySize: HISTORY_SIZE,
  })

  let conversation: ProviderMessage[] = []
  let history = [...loaded]
  let pending = ''
  let turnController: AbortController | null = null
  // Input may end (EOF, /exit, SIGINT) while lines are still buffered from a
  // pipe; drain the buffer before stopping so piped multi-prompt runs finish.
  let inputEnded = false
  let stopRequested = false

  // readline writes prompts to output even when not a terminal, which pollutes
  // piped stdout; only show the prompt when the user is actually at a console.
  const isTerminal = process.stdout.isTTY === true

  const promptString = (): string => {
    if (pending) return palette.promptMuted('… ')
    // Two-line prompt: a hint line above the input line. The mode indicator
    // stays visible when the agent is not in interactive mode.
    const mode = config.mode !== 'interactive' ? palette.promptMuted(` [${config.mode}]`) : ''
    return `${palette.promptMuted('Ask anything, /help for commands')}${mode}\n${palette.prompt('>')} `
  }

  // readline/promises' question() drops buffered lines on piped stdin, so the
  // loop is driven by the 'line' event with a buffer/waiter hand-off instead.
  const buffer: string[] = []
  let waiter: ((line: string | null) => void) | null = null

  rl.on('line', (line) => {
    if (waiter) {
      const resolve = waiter
      waiter = null
      resolve(line)
    } else {
      buffer.push(line)
    }
  })

  rl.on('close', () => {
    inputEnded = true
    const resolve = waiter
    waiter = null
    if (resolve) resolve(null)
  })

  rl.on('SIGINT', () => {
    if (turnController) turnController.abort()
    else rl.close()
  })

  const nextLine = (): Promise<string | null> => {
    if (stopRequested) return Promise.resolve(null)
    if (buffer.length > 0) return Promise.resolve(buffer.shift() ?? null)
    if (inputEnded) return Promise.resolve(null)
    return new Promise((resolve) => {
      waiter = resolve
    })
  }

  // Clear the visible screen and home the cursor; only meaningful on a real
  // terminal, where the next prompt re-renders at the top.
  const CLEAR_SCREEN = '\x1b[2J\x1b[H'

  const ctx = {
    print: (line: string) => process.stdout.write(`${line}\n`),
    dim: (s: string) => palette.promptMuted(s),
    clearScreen: () => {
      if (isTerminal) process.stdout.write(CLEAR_SCREEN)
    },
    resetConversation: () => {
      conversation = []
      history = []
      saveHistory(opts.historyFile, [])
    },
    exit: () => {
      stopRequested = true
      rl.close()
    },
    model: provider.model,
    mode: config.mode,
  }

  while (!stopRequested) {
    if (isTerminal) {
      rl.setPrompt(promptString())
      rl.prompt()
    }
    const line = await nextLine()
    if (line === null) break

    if (line === '' && !pending) continue
    if (isSlashCommand(line)) {
      runSlashCommand(line, ctx)
      continue
    }
    if (line !== '') pending = pending ? `${pending}\n${line}` : line
    if (needsContinuation(pending)) continue

    const prompt = pending
    pending = ''
    turnController = new AbortController()
    try {
      const next = await runTurn(provider, conversation, prompt, {
        controller: turnController,
      })
      const reply = next[next.length - 1]
      conversation = next
      if (reply?.role === 'assistant') process.stdout.write(`\n${reply.content}\n\n`)
      history.push(prompt)
      saveHistory(opts.historyFile, history)
    } catch (err) {
      if (turnController.signal.aborted) {
        process.stdout.write('\n(cancelled)\n\n')
      } else {
        process.stdout.write(
          `\n${palette.error('Error:')} ${err instanceof Error ? err.message : String(err)}\n\n`,
        )
      }
    } finally {
      turnController = null
    }
  }
}
