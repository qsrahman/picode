import { exec } from 'node:child_process'
import { z } from 'zod'

import type { Tool } from './types.ts'

export const runCommandName = 'run_command'

export interface ShellToolOptions {
  cwd: string
  timeout: number
}

// Output the model sees: `exit <code>` on the first line, then capped stdout
// and stderr. The status-line renderer decodes the same shape with
// decodeExitCode/excerptOf, so tool output stays a single plain string.
const OUTPUT_CAP = 6000

export function createShellTool(options: ShellToolOptions): Tool {
  return {
    name: runCommandName,
    description:
      'Run a shell command in the workspace and return its exit code, stdout, and stderr.',
    input: z.object({
      command: z.string().min(1),
      timeout: z.number().int().positive().optional(),
    }),
    execute: async (args) => {
      const { command, timeout } = args as { command: string; timeout?: number }
      return run(command, options.cwd, timeout ?? options.timeout)
    },
  }
}

function run(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: timeoutMs, shell: '/bin/sh' }, (error, stdout, stderr) => {
      if (error && error.killed) {
        // exec kills the process on timeout; report it like the `timeout`
        // command's conventional exit code so failures render as failures.
        resolve(`exit 124\n\ncommand timed out after ${timeoutMs}ms`)
        return
      }
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      const parts = [`exit ${code}`]
      if (stdout) parts.push('', cap(stdout))
      if (stderr) parts.push('', cap(stderr))
      resolve(parts.join('\n'))
    })
  })
}

function cap(text: string): string {
  if (text.length <= OUTPUT_CAP) return text
  return `${text.slice(0, OUTPUT_CAP)}\n…[output truncated: ${text.length} chars]`
}

export function decodeExitCode(output: string): number {
  const match = /^exit (\d+)/.exec(output)
  return match ? Number(match[1]) : 0
}

// Short failure snippet for the status line: the non-empty stream text after
// the exit line, never more than `max` chars.
export function excerptOf(output: string, max = 120): string {
  const body = output.replace(/^exit \d+\n+/, '').trimStart()
  if (body.length <= max) return body
  return `${body.slice(0, max)}…`
}
