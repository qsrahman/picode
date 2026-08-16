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
})
