import { mkdtemp, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGitTools } from '../../src/tools/git.ts'

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'picode-git-'))
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
    const tools = createGitTools(dir)
    const exec = (name: string, args: Record<string, unknown>) =>
      tools.find((x) => x.name === name)!.execute(args)

    expect((await exec('git_status', {})).startsWith('## ')).toBe(true)
    expect(await exec('git_log', {})).toContain('first')
    expect(await exec('git_show', { ref: 'HEAD' })).toContain('first')
    expect((await exec('git_diff', {})).trim()).toBe('')
  })

  it('returns stderr text on failure instead of throwing', async () => {
    const dir = await repo()
    const tools = createGitTools(dir)
    const out = await tools.find((x) => x.name === 'git_show')!.execute({ ref: 'nope' })
    expect(out.toLowerCase()).toContain('not')
  })
})
