import { execFile } from 'node:child_process'
import { z } from 'zod'
import type { Tool } from './types.ts'

// Run git in `root`, returning combined output. Non-zero exits return stderr
// (so the model can react) rather than throwing into the tool gate.
function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const msg = (stderr || stdout || error.message || 'git failed').trimEnd()
        resolve(msg)
        return
      }
      resolve((stdout || stderr).trimEnd())
    })
  })
}

export function createGitTools(root: string): Tool[] {
  return [
    {
      name: 'git_status',
      description: 'Show working-tree status (git status --short --branch).',
      input: z.object({}),
      execute: () => git(root, ['status', '--short', '--branch']),
    },
    {
      name: 'git_diff',
      description: 'Show a diff. Optional ref like HEAD or HEAD~1; defaults to unstaged.',
      input: z.object({ ref: z.string().optional() }),
      execute: (args) => {
        const { ref } = args as { ref?: string }
        return git(root, ref ? ['diff', ref] : ['diff'])
      },
    },
    {
      name: 'git_log',
      description: 'Show recent commit history (one line each).',
      input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      execute: (args) => {
        const { limit } = args as { limit?: number }
        return git(root, ['log', '--oneline', `-${limit ?? 20}`])
      },
    },
    {
      name: 'git_show',
      description: 'Show a commit, file at a ref, or object. Optional ref; defaults to HEAD.',
      input: z.object({ ref: z.string().optional() }),
      execute: (args) => {
        const { ref } = args as { ref?: string }
        return git(root, ['show', ref ?? 'HEAD'])
      },
    },
  ]
}
