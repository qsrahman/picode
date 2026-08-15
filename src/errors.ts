// User-facing errors that main() turns into a one-line message + exit code,
// instead of a stack trace.
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

// Errors cross trust boundaries as `unknown`; coerce uniformly for messages.
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
