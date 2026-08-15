import type { Palette } from './palette.ts'

export interface StreamWriterOptions {
  write: (s: string) => void
  palette: Palette
  // Status lines (cursor tricks, timers) only make sense on a real terminal.
  enabled: boolean
  noStream?: boolean
}

// Renders streamed model text and a single in-place tool status line. The
// running line (`› shell: pnpm test 1.2s`) is rewritten in place by the
// elapsed timer so it never pollutes scrollback; endStatus settles it into one
// permanent line. All ANSI control happens through the injected `write`, so
// tests capture it like any other output.
export class StreamWriter {
  private readonly options: StreamWriterOptions
  private active: { summary: string; startedAt: number } | null = null
  private timer: NodeJS.Timeout | null = null
  // Whether the last write ended on a fresh line; startStatus skips its own
  // leading newline in that case so a status line after `> input`'s blank
  // line isn't double-spaced.
  private atLineStart = true

  constructor(options: StreamWriterOptions) {
    this.options = options
  }

  text(delta: string): void {
    if (this.options.noStream) return
    this.options.write(delta)
    this.atLineStart = delta.endsWith('\n')
  }

  startStatus(summary: string): void {
    if (!this.options.enabled) return
    this.endStatus('')
    this.active = { summary, startedAt: Date.now() }
    if (!this.atLineStart) this.options.write('\n')
    this.render()
    this.atLineStart = true
    this.timer = setInterval(() => this.render(), 200)
  }

  // Freezes the running line while the approval prompt sits below it; the
  // caller moves the cursor back onto the status line before resuming.
  pauseStatus(): void {
    this.stopTimer()
  }

  resumeStatus(): void {
    if (this.options.enabled && this.active && !this.timer) {
      this.timer = setInterval(() => this.render(), 200)
    }
  }

  // Replaces the running line's timer with the settled appendix
  // (e.g. `✓ done (2.1s)`), preserving the summary. `details` renders below.
  endStatus(appendix: string, details?: string): void {
    if (!this.options.enabled || !this.active) return
    this.stopTimer()
    this.options.write('\r\x1b[2K')
    this.options.write(`› ${this.options.palette.promptMuted(this.active.summary)}`)
    if (appendix) this.options.write(` ${appendix}`)
    this.options.write('\n')
    if (details) this.options.write(`${details}\n`)
    this.active = null
    this.atLineStart = true
  }

  private render(): void {
    if (!this.active) return
    const elapsed = `${((Date.now() - this.active.startedAt) / 1000).toFixed(1)}s`
    this.options.write(
      `\r\x1b[2K› ${this.options.palette.promptMuted(this.active.summary)} ${this.options.palette.promptMuted(elapsed)}`,
    )
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
