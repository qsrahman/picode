import { Ansis } from 'ansis'

export interface Palette {
  prompt: (s: string) => string
  promptMuted: (s: string) => string
  assistant: (s: string) => string
  tool: (s: string) => string
  error: (s: string) => string
  tip: (s: string) => string
}

// Ansis(2) forces codes on and Ansis(0) strips them, so output is deterministic
// in non-TTY contexts (pipes, tests) instead of silently losing color.
export function createPalette(color: boolean): Palette {
  const a = new Ansis(color ? 2 : 0)
  return {
    prompt: (s) => a.green(s),
    promptMuted: (s) => a.dim(s),
    assistant: (s) => s,
    tool: (s) => a.blue(s),
    error: (s) => a.red(s),
    tip: (s) => a.dim(s),
  }
}

export function shouldUseColor(
  opts: { noColor: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (opts.noColor) return false
  if (env.NO_COLOR) return false
  return true
}
