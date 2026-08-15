import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPalette } from '../../src/utils/palette.ts'
import { StreamWriter } from '../../src/utils/stream.ts'

function captured(enabled: boolean, noStream = false) {
  const writes: string[] = []
  const writer = new StreamWriter({
    write: (s) => writes.push(s),
    palette: createPalette(false),
    enabled,
    noStream,
  })
  return { writes, writer }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('StreamWriter', () => {
  it('writes streamed text deltas', () => {
    const { writes, writer } = captured(true)
    writer.text('hel')
    writer.text('lo')
    expect(writes).toEqual(['hel', 'lo'])
  })

  it('drops text deltas in no-stream mode', () => {
    const { writes, writer } = captured(true, true)
    writer.text('dropped')
    expect(writes).toEqual([])
  })

  it('renders a running status line with an in-place elapsed timer', () => {
    vi.useFakeTimers()
    const { writes, writer } = captured(true)
    writer.startStatus('shell: echo hi')
    expect(writes.join('').includes('› shell: echo hi')).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(writes.join('').includes('1.0s')).toBe(true)
  })

  it('does not double-space a status line after a fresh line', () => {
    const { writes, writer } = captured(true)
    writer.startStatus('shell: echo hi')
    writer.endStatus('✓ done (0.0s)')
    expect(writes.join('')).toBe(
      '\r\x1b[2K› shell: echo hi 0.0s\r\x1b[2K› shell: echo hi ✓ done (0.0s)\n',
    )
  })

  it('drops to a fresh line for the status when text ended mid-line', () => {
    const { writes, writer } = captured(true)
    writer.text('mid-line text')
    writer.startStatus('shell: echo hi')
    writer.endStatus('✓ done (0.0s)')
    expect(writes.join('')).toBe(
      'mid-line text\n\r\x1b[2K› shell: echo hi 0.0s\r\x1b[2K› shell: echo hi ✓ done (0.0s)\n',
    )
  })

  it('freezes the running line while paused and resumes on demand', () => {
    vi.useFakeTimers()
    const { writes, writer } = captured(true)
    writer.startStatus('shell: echo hi')
    writer.pauseStatus()
    const frozen = writes.length
    vi.advanceTimersByTime(1000)
    expect(writes.length).toBe(frozen)
    writer.resumeStatus()
    vi.advanceTimersByTime(200)
    expect(writes.join('').includes('1.2s')).toBe(true)
  })

  it('settles into one line with the summary and appendix', () => {
    vi.useFakeTimers()
    const { writes, writer } = captured(true)
    writer.startStatus('shell: echo hi')
    vi.advanceTimersByTime(500)
    writer.endStatus('✓ done (0.5s)')
    vi.advanceTimersByTime(1000)
    expect(writes.join('').includes('› shell: echo hi ✓ done (0.5s)')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('appends detail lines below the settled line', () => {
    const { writes, writer } = captured(true)
    writer.startStatus('shell: oops')
    writer.endStatus('✗ failed (exit 1, 0.0s)', 'something broke')
    expect(writes.join('').includes('something broke')).toBe(true)
  })

  it('does nothing when status rendering is disabled', () => {
    const { writes, writer } = captured(false)
    writer.startStatus('shell: echo hi')
    writer.endStatus('✓ done (0.0s)')
    writer.text('hello')
    expect(writes.join('')).toBe('hello')
  })
})
