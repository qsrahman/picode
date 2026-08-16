import { describe, expect, it } from 'vitest'

import { parseCli } from '../../src/cli/args.ts'
import { CliError } from '../../src/errors.ts'

describe('parseCli', () => {
  it('returns defaults when given no arguments', () => {
    expect(parseCli([])).toEqual({
      model: undefined,
      mode: undefined,
      config: undefined,
      noStream: false,
      verbose: false,
      noColor: false,
      version: false,
      help: false,
      prompt: '',
    })
  })

  it('joins positionals into the prompt', () => {
    expect(parseCli(['explain', 'this', 'code']).prompt).toBe('explain this code')
  })

  it('parses a string flag value', () => {
    expect(parseCli(['--model', 'gpt-4.1']).model).toBe('gpt-4.1')
  })

  it('parses boolean flags', () => {
    const args = parseCli(['--no-stream', '--verbose', '--no-color'])
    expect(args.noStream).toBe(true)
    expect(args.verbose).toBe(true)
    expect(args.noColor).toBe(true)
  })

  it('supports --flag=value syntax', () => {
    expect(parseCli(['--config=./picode.json']).config).toBe('./picode.json')
  })

  it('resolves --mode auto from --auto', () => {
    expect(parseCli(['--auto']).mode).toBe('auto')
  })

  it('resolves --mode plan from --plan', () => {
    expect(parseCli(['--plan']).mode).toBe('plan')
  })

  it('gives explicit --mode precedence over the aliases', () => {
    expect(parseCli(['--mode', 'plan', '--auto']).mode).toBe('plan')
    expect(parseCli(['--mode', 'auto', '--plan']).mode).toBe('auto')
  })

  it('rejects an invalid --mode', () => {
    expect(() => parseCli(['--mode', 'bogus'])).toThrow(CliError)
  })

  it('rejects an unknown flag', () => {
    expect(() => parseCli(['--nope'])).toThrow(CliError)
  })
})
