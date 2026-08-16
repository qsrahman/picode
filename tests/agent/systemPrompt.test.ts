import { describe, expect, it } from 'vitest'
import { DEFAULT_INSTRUCTIONS } from '../../src/agent/systemPrompt.ts'

describe('DEFAULT_INSTRUCTIONS', () => {
  it('names every registered tool', () => {
    const tools = [
      'read_file',
      'write_file',
      'edit_file',
      'list_dir',
      'stat',
      'run_command',
      'git_status',
      'git_diff',
      'git_log',
      'git_show',
      'web_search',
      'web_fetch',
      'run_agent',
      'todo',
    ]
    for (const tool of tools) {
      expect(DEFAULT_INSTRUCTIONS).toContain(tool)
    }
  })

  it('tells the model to prefer edit_file over write_file for existing files', () => {
    expect(DEFAULT_INSTRUCTIONS).toMatch(/edit_file/)
    expect(DEFAULT_INSTRUCTIONS.toLowerCase()).toContain(
      "discards everything the edit didn't intend to touch",
    )
  })

  it('tells the model run_agent cannot ask for approval or spawn further sub-agents', () => {
    expect(DEFAULT_INSTRUCTIONS).toContain('run_agent')
    expect(DEFAULT_INSTRUCTIONS.toLowerCase()).toContain('spawn further sub-agents')
  })

  it('tells the model to track multi-step work with todo', () => {
    expect(DEFAULT_INSTRUCTIONS).toContain('todo')
    expect(DEFAULT_INSTRUCTIONS.toLowerCase()).toContain('tracked checklist')
  })
})
