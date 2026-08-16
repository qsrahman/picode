import { readFile, writeFile, readdir, stat as fsStat, mkdir } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import type { Tool } from './types.ts'

export interface FsToolContext {
  root: string
  additionalDirs: string[]
}

// Resolve `p` and reject it unless it lands inside `root` or one of the
// configured additional dirs. Keeps every file op confined to the workspace.
function confine(root: string, additionalDirs: string[], p: string): string {
  const abs = isAbsolute(p) ? p : resolve(root, p)
  const allowed = [root, ...additionalDirs].map((d) => resolve(d))
  if (allowed.some((d) => abs === d || abs.startsWith(d + '/'))) return abs
  throw new Error(`path outside workspace: ${p}`)
}

function infoOf(st: Stats): string {
  return JSON.stringify({
    type: st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other',
    size: st.size,
    mtime: st.mtimeMs,
  })
}

// Non-overlapping occurrence count, used to require old_string to be
// unambiguous before editing (same contract as Claude Code's Edit tool).
function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return count
    count++
    from = at + needle.length
  }
}

// Replaces the first occurrence only. Deliberately not String.prototype.replace:
// its replacement-string argument treats `$&`/`$1`/`$$` specially even for a
// literal search string, which would corrupt a `new_string` containing `$`.
function replaceOnce(content: string, oldString: string, newString: string): string {
  const at = content.indexOf(oldString)
  return content.slice(0, at) + newString + content.slice(at + oldString.length)
}

export function createFsTools(ctx: FsToolContext): Tool[] {
  const locate = (p: string) => confine(ctx.root, ctx.additionalDirs, p)

  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 file inside the workspace. Use to inspect source.',
      input: z.object({ path: z.string() }),
      execute: async (args) => {
        const { path } = args as { path: string }
        return readFile(locate(path), 'utf8')
      },
    },
    {
      name: 'write_file',
      description:
        'Write UTF-8 content to a file inside the workspace, creating parent ' +
        'directories. Overwrites existing files. Use for edits and new files.',
      input: z.object({ path: z.string(), content: z.string() }),
      execute: async (args) => {
        const { path, content } = args as { path: string; content: string }
        const abs = locate(path)
        await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true })
        await writeFile(abs, content, 'utf8')
        return `wrote ${path} (${content.length} bytes)`
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace an exact substring in a file inside the workspace, without ' +
        'rewriting the rest of it. old_string must match exactly once ' +
        '(including whitespace/indentation) unless replace_all is set. Use ' +
        'for targeted edits; use write_file to create a file or replace it ' +
        'wholesale.',
      input: z.object({
        path: z.string().min(1),
        old_string: z.string().min(1),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
      }),
      execute: async (args) => {
        const { path, old_string, new_string, replace_all } = args as {
          path: string
          old_string: string
          new_string: string
          replace_all?: boolean
        }
        const abs = locate(path)
        const content = await readFile(abs, 'utf8')
        const count = countOccurrences(content, old_string)
        if (count === 0) {
          return `old_string not found in ${path}`
        }
        if (count > 1 && !replace_all) {
          return (
            `old_string matches ${count} times in ${path}; add more context to ` +
            `old_string to make it unique, or pass replace_all: true`
          )
        }
        const updated = replace_all
          ? content.split(old_string).join(new_string)
          : replaceOnce(content, old_string, new_string)
        await writeFile(abs, updated, 'utf8')
        const replaced = replace_all ? count : 1
        return `edited ${path} (${replaced} replacement${replaced === 1 ? '' : 's'})`
      },
    },
    {
      name: 'list_dir',
      description: 'List entries of a directory inside the workspace.',
      input: z.object({ path: z.string() }),
      execute: async (args) => {
        const { path } = args as { path: string }
        const entries = await readdir(locate(path), { withFileTypes: true })
        return entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join('\n')
      },
    },
    {
      name: 'stat',
      description: 'Report type/size/mtime of a file or directory inside the workspace.',
      input: z.object({ path: z.string() }),
      execute: async (args) => {
        const { path } = args as { path: string }
        return infoOf(await fsStat(locate(path)))
      },
    },
  ]
}
