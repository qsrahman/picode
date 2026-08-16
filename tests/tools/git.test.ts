import { mkdtemp, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGitTools } from '../../src/tools/git.ts'

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pcode-git-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  await writeFile(join(dir, 'f.txt'), 'one')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'first'], { cwd: dir })
  return dir
}

describe('git tools', () => {
  it('reports status, log, show, and diff', async () => {
    const dir = await repo()
    const t = Object.fromEntries(createGitTools(dir).map((x) => [x.name, x]))

    expect((await t.git_status.execute({})).startsWith('## ')).toBe(true)
    expect(await t.git_log.execute({})).toContain('first')
    expect(await t.git_show.execute({ ref: 'HEAD' })).toContain('first')
    expect((await t.git_diff.execute({})).trim()).toBe('')
  })

  it('returns stderr text on failure instead of throwing', async () => {
    const dir = await repo()
    const t = Object.fromEntries(createGitTools(dir).map((x) => [x.name, x]))
    expect((await t.git_show.execute({ ref: 'nope' })).toLowerCase()).toContain('not')
  })
})
