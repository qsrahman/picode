import { type Permission, type ToolRules } from '../config/schema.ts'

// The engine works purely on `Tool(pattern)` strings (e.g. `Bash(pnpm test *)`,
// `Edit(src/**)`, `Read(.env)`). Translating a concrete tool call into one of
// those strings is policy.ts's job, so this module stays free of tool names
// and is unit-testable in isolation.
export type Decision = 'allow' | 'ask' | 'deny'

type Category = 'shell' | 'edit' | 'read' | 'webSearch' | 'webFetch' | 'agent' | 'todo'

// Parse `Bash(cmd)` / `Edit(path)` / `Read(path)` / `WebSearch(query)` /
// `WebFetch(url)` / `Agent(description)` into a category + operand. Anything
// the permission config can't express yet (e.g. `mcp.*`) returns null so the
// caller falls back to its default, rather than silently matching.
export function parseToolPattern(input: string): { kind: Category; operand: string } | null {
  const m = /^([A-Za-z][\w.]*)\((.*)\)$/.exec(input.trim())
  if (!m) return null
  const name = m[1]
  const operand = m[2] ?? ''
  if (name === 'Bash' || name === 'Shell') return { kind: 'shell', operand }
  if (name === 'Edit') return { kind: 'edit', operand }
  if (name === 'Read') return { kind: 'read', operand }
  if (name === 'WebSearch') return { kind: 'webSearch', operand }
  if (name === 'WebFetch') return { kind: 'webFetch', operand }
  if (name === 'Agent') return { kind: 'agent', operand }
  if (name === 'Todo') return { kind: 'todo', operand }
  return null
}

// `*`/`?` match within a path segment; `**` crosses segments. Commands treat
// `*` as crossing `/` too (crossSlash), since shell operands are not paths.
function buildMatcher(glob: string, crossSlash: boolean): RegExp {
  let re = ''
  let i = 0
  while (i < glob.length) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 2
        continue
      }
      re += crossSlash ? '.*' : '[^/]*'
      i++
      continue
    }
    if (c === '?') {
      re += crossSlash ? '.' : '[^/]'
      i++
      continue
    }
    re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    i++
  }
  return new RegExp(`^${re}$`)
}

export function matchGlob(glob: string, text: string): boolean {
  return buildMatcher(glob, true).test(text)
}

export function matchPathGlob(glob: string, text: string): boolean {
  return buildMatcher(glob, false).test(text)
}

// Split a command line into its sub-commands and strip the wrappers the model
// tends to add (`timeout 10`, `nohup`, `FOO=bar` assignments, `sudo`). Each
// surviving piece is matched independently so a benign prefix can't launder a
// destructive subcommand.
export function splitCommand(cmd: string): string[] {
  return cmd
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((part) => stripWrapper(part.trim()))
    .filter((part) => part.length > 0)
}

function stripWrapper(part: string): string {
  return part
    .replace(/^(?:\w+=\S+\s+)+/, '')
    .replace(/^(?:sudo\s+|timeout\s+\d+\s+|nohup\s+|env\s+)/, '')
    .trim()
}

// Fold several sub-decisions into one, honoring deny > ask > allow. A null is
// "no rule matched" and is ignored unless every input is null.
export function combineDecisions(decisions: (Decision | null)[]): Decision | null {
  let result: Decision | null = null
  for (const d of decisions) {
    if (d === null) continue
    if (d === 'deny') return 'deny'
    if (d === 'ask') result = 'ask'
    else if (d === 'allow' && result === null) result = 'allow'
  }
  return result
}

// Evaluate a single `Tool(pattern)` string against the config. Returns the
// highest-precedence matching decision, or null when nothing matched (caller
// applies mode/policy defaults).
export function evaluatePattern(toolPattern: string, rules: Permission): Decision | null {
  const parsed = parseToolPattern(toolPattern)
  if (!parsed) return null
  const category: ToolRules = rules[parsed.kind]
  // Filesystem patterns (Edit/Read) use path-glob semantics (`*` stops at a
  // `/`); Bash and Web operands aren't nested paths, so a bare `*` crosses
  // segments there too.
  const isPath = parsed.kind === 'edit' || parsed.kind === 'read'
  const matches = (list: string[]): boolean =>
    list.some((rule) => {
      const rp = parseToolPattern(rule)
      if (!rp || rp.kind !== parsed.kind) return false
      return isPath
        ? matchPathGlob(rp.operand, parsed.operand)
        : matchGlob(rp.operand, parsed.operand)
    })
  if (matches(category.deny)) return 'deny'
  if (matches(category.ask)) return 'ask'
  if (matches(category.allow)) return 'allow'
  return null
}

// Return the first literal rule in a list that matches the call pattern, for
// surfacing which rule fired (prompt preview / denial feedback).
export function matchRuleInList(toolPattern: string, list: string[]): string | null {
  const parsed = parseToolPattern(toolPattern)
  if (!parsed) return null
  const isPath = parsed.kind === 'edit' || parsed.kind === 'read'
  for (const rule of list) {
    const rp = parseToolPattern(rule)
    if (!rp || rp.kind !== parsed.kind) continue
    if (isPath ? matchPathGlob(rp.operand, parsed.operand) : matchGlob(rp.operand, parsed.operand))
      return rule
  }
  return null
}
