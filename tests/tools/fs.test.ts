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
    await expect(
      list
        .find((x) => x.name === 'edit_file')!
        .execute({ path: '../escape.txt', old_string: 'a', new_string: 'b' }),
    ).rejects.toThrow(/workspace/)
  })
})

describe('edit_file', () => {
  async function setup(content: string) {
    const root = await tmp()
    await writeFile(join(root, 'a.txt'), content)
    const tools = createFsTools({ root, additionalDirs: [] })
    const edit = (args: Record<string, unknown>) =>
      tools.find((x) => x.name === 'edit_file')!.execute(args)
    return { root, edit }
  }

  it('replaces a unique match', async () => {
    const { root, edit } = await setup('const x = 1\nconst y = 2\n')
    expect(
      await edit({ path: 'a.txt', old_string: 'const x = 1', new_string: 'const x = 99' }),
    ).toBe('edited a.txt (1 replacement)')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('const x = 99\nconst y = 2\n')
  })

  it('reports when old_string is not found', async () => {
    const { edit } = await setup('hello\n')
    expect(await edit({ path: 'a.txt', old_string: 'nope', new_string: 'x' })).toBe(
      'old_string not found in a.txt',
    )
  })

  it('refuses an ambiguous match without replace_all', async () => {
    const { root, edit } = await setup('foo\nfoo\n')
    const out = await edit({ path: 'a.txt', old_string: 'foo', new_string: 'bar' })
    expect(out).toContain('matches 2 times')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('foo\nfoo\n')
  })

  it('replaces every match when replace_all is set', async () => {
    const { root, edit } = await setup('foo\nfoo\nfoo\n')
    expect(
      await edit({ path: 'a.txt', old_string: 'foo', new_string: 'bar', replace_all: true }),
    ).toBe('edited a.txt (3 replacements)')
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('bar\nbar\nbar\n')
  })

  it('treats new_string literally, not as a $-pattern replacement', async () => {
    const { root, edit } = await setup('price: PLACEHOLDER\n')
    await edit({ path: 'a.txt', old_string: 'PLACEHOLDER', new_string: '$100 ($&)' })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('price: $100 ($&)\n')
  })
})
