import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createShellTool,
  decodeExitCode,
  excerptOf,
  runCommandName,
} from '../../src/tools/shell.ts'
import { ToolRegistry } from '../../src/tools/registry.ts'

function makeTool(timeout = 5000) {
  const cwd = mkdtempSync(join(tmpdir(), 'pcode-shell-'))
  return createShellTool({ cwd, timeout })
}

describe('run_command', () => {
  it('returns exit 0 with stdout', async () => {
    const tool = makeTool()
    const output = await tool.execute({ command: 'echo hello' })
    expect(output.startsWith('exit 0')).toBe(true)
    expect(output).toContain('hello')
  })

  it('reports a non-zero exit code', async () => {
    const tool = makeTool()
    const output = await tool.execute({ command: 'exit 3' })
    expect(output.startsWith('exit 3')).toBe(true)
  })

  it('captures stderr', async () => {
    const tool = makeTool()
    const output = await tool.execute({ command: 'echo oops >&2' })
    expect(output).toContain('oops')
  })

  it('times out and reports exit 124', async () => {
    const tool = makeTool(200)
    const output = await tool.execute({ command: 'sleep 2' })
    expect(output.startsWith('exit 124')).toBe(true)
    expect(output).toContain('timed out')
  })

  it('caps oversized output', async () => {
    const tool = makeTool()
    const output = await tool.execute({
      command: 'node -e "process.stdout.write(\'x\'.repeat(10000))"',
    })
    expect(output).toContain('truncated')
    expect(output.length).toBeLessThan(7000)
  })

  it('rejects invalid arguments through the registry', async () => {
    const tool = makeTool()
    const registry = new ToolRegistry().register(tool)
    const result = await registry.execute({ callId: 'c1', name: runCommandName, args: {} })
    expect(result.output.startsWith('invalid arguments for')).toBe(true)
  })
})

describe('output helpers', () => {
  it('decodes the exit code from the first line', () => {
    expect(decodeExitCode('exit 7\n\nboom')).toBe(7)
    expect(decodeExitCode('plain text')).toBe(0)
  })

  it('extracts a short excerpt after the exit line', () => {
    expect(excerptOf('exit 1\n\nsomething went wrong')).toBe('something went wrong')
    expect(excerptOf('exit 1\n\n' + 'x'.repeat(200)).length).toBe(121)
  })
})

describe('run_command tool identity', () => {
  it('exposes the run_command name', () => {
    expect(runCommandName).toBe('run_command')
  })
})
