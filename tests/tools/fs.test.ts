import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFsTools } from '../../src/tools/fs.ts'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pcode-fs-'))
}

function tools(root: string) {
  return Object.fromEntries(createFsTools({ root, additionalDirs: [] }).map((t) => [t.name, t]))
}

describe('fs tools', () => {
  it('reads, writes, lists, and stats confined files', async () => {
    const root = await tmp()
    const t = tools(root)
    await writeFile(join(root, 'a.txt'), 'hello')

    expect(await t.read_file.execute({ path: 'a.txt' })).toBe('hello')

    expect(await t.write_file.execute({ path: 'sub/b.txt', content: 'x' })).toBe(
      'wrote sub/b.txt (1 bytes)',
    )
    expect(await readFile(join(root, 'sub/b.txt'), 'utf8')).toBe('x')

    expect((await t.list_dir.execute({ path: '.' })).split('\n').sort()).toEqual(['a.txt', 'sub/'])

    const info = JSON.parse(await t.stat.execute({ path: 'a.txt' })) as { type: string }
    expect(info.type).toBe('file')
  })

  it('rejects paths outside the workspace', async () => {
    const root = await tmp()
    const t = tools(root)
    await expect(t.read_file.execute({ path: '../escape.txt' })).rejects.toThrow(/workspace/)
  })
})
