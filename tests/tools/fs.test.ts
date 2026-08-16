import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFsTools } from '../../src/tools/fs.ts'

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pcode-fs-'))
}

describe('fs tools', () => {
  it('reads, writes, lists, and stats confined files', async () => {
    const root = await tmp()
    const list = createFsTools({ root, additionalDirs: [] })
    const exec = (name: string, args: Record<string, unknown>) =>
      list.find((x) => x.name === name)!.execute(args)
    await writeFile(join(root, 'a.txt'), 'hello')

    expect(await exec('read_file', { path: 'a.txt' })).toBe('hello')

    expect(await exec('write_file', { path: 'sub/b.txt', content: 'x' })).toBe(
      'wrote sub/b.txt (1 bytes)',
    )
    expect(await readFile(join(root, 'sub/b.txt'), 'utf8')).toBe('x')

    expect((await exec('list_dir', { path: '.' })).split('\n').sort()).toEqual(['a.txt', 'sub/'])

    const info = JSON.parse(await exec('stat', { path: 'a.txt' })) as { type: string }
    expect(info.type).toBe('file')
  })

  it('rejects paths outside the workspace', async () => {
    const root = await tmp()
    const list = createFsTools({ root, additionalDirs: [] })
    await expect(
      list.find((x) => x.name === 'read_file')!.execute({ path: '../escape.txt' }),
    ).rejects.toThrow(/workspace/)
  })
})
