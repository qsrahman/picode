import * as readline from 'node:readline'
import type { CliOptions } from './args.ts'
import type { Config } from '../config/schema.ts'
import type { Provider, ProviderItem } from '../agent/provider.ts'
import { MAX_TOOL_ROUNDS, runTurn } from '../agent/agent.ts'
import type { ToolRegistry } from '../tools/registry.ts'
import type { ToolCall, ToolDefinition, ToolResult } from '../tools/types.ts'
import { decodeExitCode, excerptOf, runCommandName } from '../tools/shell.ts'
import type { Palette } from '../utils/palette.ts'
import { StreamWriter } from '../utils/stream.ts'
import { isCommand, runCommand } from './commands.ts'
import { messageOf } from '../errors.ts'
import { HISTORY_SIZE, loadHistory, saveHistory } from './history.ts'
import { approvalKey, summaryOf, applyApprovalAnswer } from './approval.ts'

export interface ReplOptions {
  provider: Provider
  config: Config
  palette: Palette
  historyFile: string
  args: CliOptions
  registry: ToolRegistry
  tools: ToolDefinition[]
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

export async function runRepl(opts: ReplOptions): Promise<void> {
  const { provider, config, palette } = opts
  const loaded = loadHistory(opts.historyFile)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    history: loaded,
    historySize: HISTORY_SIZE,
  })

  let conversation: ProviderItem[] = []
  let pending = ''
  let turnController: AbortController | null = null
  // Input may end (EOF, /exit, SIGINT) while lines are still buffered from a
  // pipe; drain the buffer before stopping so piped multi-prompt runs finish.
  let inputEnded = false
  let stopRequested = false

  // readline writes prompts to output even when not a terminal, which pollutes
  // piped stdout; only show the prompt when the user is actually at a console.
  const isTerminal = process.stdout.isTTY === true
  const writer = new StreamWriter({
    write: (s) => process.stdout.write(s),
    palette,
    enabled: isTerminal,
    noStream: opts.args.noStream,
  })

  const promptString = (): string => {
    if (pending) return palette.promptMuted('… ')
    // Two-line prompt: a plain hint line above the input line. The mode
    // indicator stays visible when the agent is not in interactive mode.
    const mode = config.mode !== 'interactive' ? ` [${config.mode}]` : ''
    return `Ask anything, /help for commands${mode}\n${palette.prompt('>')} `
  }

  // readline/promises' question() drops buffered lines on piped stdin, so the
  // loop is driven by the 'line' event with a buffer/waiter hand-off instead.
  const buffer: string[] = []
  let waiter: ((line: string | null) => void) | null = null
  // During an approval prompt the next line belongs to the prompt, not the
  // conversation buffer.
  let awaitingApproval = false
  let approvalWaiter: ((line: string) => void) | null = null

  rl.on('line', (line) => {
    if (awaitingApproval) {
      const resolve = approvalWaiter
      approvalWaiter = null
      awaitingApproval = false
      if (resolve) resolve(line)
      return
    }
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
    // A pending approval prompt must not hang the process on EOF (e.g. piped
    // stdin); resolve it as a deny.
    const approve = approvalWaiter
    approvalWaiter = null
    awaitingApproval = false
    if (approve) approve('n')
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
      saveHistory(opts.historyFile, [])
    },
    exit: () => {
      stopRequested = true
      rl.close()
    },
    model: provider.model,
    mode: config.mode,
  }

  const sessionApprovals = new Set<string>()
  // Set when a tool status line has started this turn; onText uses it to
  // separate the settled status line from the final answer text.
  let toolSettled = false

  // Runs between the pending status line and execution. Returns to the status
  // line (clearing the prompt) on any answer so the elapsed timer can keep
  // updating in place while the tool runs.
  const askApproval = (): Promise<string> => {
    return new Promise((resolve) => {
      process.stdout.write(`  ${palette.prompt('Run? (y/n/a)')} `)
      awaitingApproval = true
      approvalWaiter = (line) => {
        process.stdout.write('\x1b[1A\r\x1b[2K')
        resolve(line.trim().toLowerCase())
      }
    })
  }

  // Injected into the agent loop: approve by mode, remember session approvals,
  // and prompt interactively only when actually at a terminal.
  const requestApproval = async (call: ToolCall): Promise<boolean> => {
    if (config.mode === 'plan') {
      process.stdout.write(`\n${palette.tool('✗ denied (plan mode)')}\n`)
      return false
    }
    if (config.mode === 'interactive' && !isTerminal) {
      process.stdout.write(`\n${palette.tool('✗ denied (non-interactive)')}\n`)
      return false
    }
    const key = approvalKey(call)
    const sessionOk = sessionApprovals.has(key)
    writer.startStatus(summaryOf(call, opts.args.verbose))
    toolSettled = true
    if (config.mode === 'auto' || sessionOk) return true
    writer.pauseStatus()
    const answer = await askApproval()
    const approved = applyApprovalAnswer(answer, key, sessionApprovals)
    if (approved) {
      writer.resumeStatus()
      return true
    }
    writer.endStatus(palette.tool('✗ denied'))
    return false
  }

  const onToolResult = (call: ToolCall, result: ToolResult, ms: number): void => {
    const seconds = `${(ms / 1000).toFixed(1)}s`
    if (call.name !== runCommandName) {
      writer.endStatus(palette.promptMuted(`✓ done (${seconds})`))
      return
    }
    const exit = decodeExitCode(result.output)
    if (exit === 0) {
      writer.endStatus(
        palette.promptMuted(`✓ done (${seconds})`),
        opts.args.verbose ? palette.promptMuted(result.output) : undefined,
      )
    } else {
      writer.endStatus(
        palette.error(`✗ failed (exit ${exit}, ${seconds})`),
        palette.promptMuted(excerptOf(result.output)),
      )
    }
  }

  while (!stopRequested) {
    if (isTerminal) {
      rl.setPrompt(promptString())
      rl.prompt()
    }
    const line = await nextLine()
    if (line === null) break

    if (line === '' && !pending) continue
    if (isCommand(line)) {
      runCommand(line, ctx)
      continue
    }
    if (line !== '') pending = pending ? `${pending}\n${line}` : line
    if (needsContinuation(pending)) continue

    const prompt = pending
    pending = ''
    turnController = new AbortController()
    let streamedText = false
    let lastDeltaNewline = false
    let separatorWritten = false
    let truncated = false
    toolSettled = false
    try {
      // A leading blank line separates the turn from the prompt line; the
      // status separator and trailing blank below complete the rhythm
      // `> input / blank / › status / blank / output / blank / prompt`.
      if (!opts.args.noStream) process.stdout.write('\n')
      const result = await runTurn(provider, conversation, prompt, {
        controller: turnController,
        tools: opts.tools,
        registry: opts.registry,
        onText: (delta) => {
          if (opts.args.noStream) return
          if (toolSettled && !separatorWritten) {
            process.stdout.write('\n')
            separatorWritten = true
          }
          writer.text(delta)
          streamedText = true
          lastDeltaNewline = delta.endsWith('\n')
        },
        requestApproval,
        onToolResult,
      })
      conversation = result.items
      truncated = result.truncated
      if (opts.args.noStream && result.text) process.stdout.write(`\n${result.text}\n\n`)
    } catch (err) {
      if (turnController.signal.aborted) {
        process.stdout.write('\n(cancelled)\n\n')
      } else {
        process.stdout.write(`\n${palette.error('Error:')} ${messageOf(err)}\n\n`)
      }
    } finally {
      turnController = null
    }
    // Exactly one blank line before the next prompt, whether or not the
    // model's last delta ended on a newline.
    if (streamedText && !truncated) {
      process.stdout.write('\n')
      if (!lastDeltaNewline) process.stdout.write('\n')
    }
    if (truncated) {
      process.stdout.write(
        `\n${palette.error('Error:')} tool call limit reached (${MAX_TOOL_ROUNDS} rounds)\n\n`,
      )
    }
  }
}
