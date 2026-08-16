// Built-in read-only bash command set. These run unprompted (always `allow`)
// and define what "read-only" means for shell calls, including in plan mode.
// Intentionally conservative: anything that can mutate state is excluded.
export const READONLY_SHELL = new Set([
  'ls',
  'cat',
  'grep',
  'egrep',
  'fgrep',
  'git',
  'head',
  'tail',
  'wc',
  'find',
  'echo',
  'pwd',
  'which',
  'readlink',
  'file',
  'diff',
  'sort',
  'uniq',
  'cut',
  'tr',
  'tree',
  'less',
  'more',
  'printf',
  'test',
  'env',
])

export function isReadonlyCommand(command: string): boolean {
  const subs = command.trim().split(/\s+/)
  const base = subs[0]
  return base !== undefined && READONLY_SHELL.has(base)
}
