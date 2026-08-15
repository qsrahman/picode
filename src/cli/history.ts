import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const HISTORY_SIZE = 1000

export function loadHistory(path: string): string[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .slice(-HISTORY_SIZE)
  } catch {
    return []
  }
}

export function saveHistory(path: string, entries: string[]): void {
  const capped = entries.slice(-HISTORY_SIZE)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, capped.length > 0 ? `${capped.join('\n')}\n` : '')
  } catch {
    // History persistence is best-effort; a read-only home should not break the REPL.
  }
}
