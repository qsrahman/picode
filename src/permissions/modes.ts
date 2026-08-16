import type { Mode } from '../config/schema.ts'

// Prompt-line indicator for non-interactive modes. Empty in interactive so the
// hint stays quiet by default.
export function modeIndicator(mode: Mode): string {
  if (mode === 'auto') return '[auto]'
  if (mode === 'plan') return '[plan]'
  return ''
}
