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
      name: 'list_dir',
      description: 'List entries of a directory inside the workspace.',
      input: z.object({ path: z.string() }),
      execute: async (args) => {
        const { path } = args as { path: string }
        const entries = await readdir(locate(path), { withFileTypes: true })
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort().join('\n')
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
