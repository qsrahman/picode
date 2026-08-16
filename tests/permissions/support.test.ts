import { describe, expect, it } from 'vitest'

import { shellBreakers, destructiveBreaker, escapingBreaker } from '../../src/permissions/breaker.ts'
import { isReadonlyCommand, READONLY_SHELL } from '../../src/permissions/readonly.ts'
import { modeIndicator } from '../../src/permissions/modes.ts'

describe('readonly set', () => {
  it('treats safe commands as read-only', () => {
    expect(isReadonlyCommand('ls -F')).toBe(true)
    expect(isReadonlyCommand('git status')).toBe(true)
    expect(isReadonlyCommand('grep -r x .')).toBe(true)
  })

  it('treats mutating or unknown commands as not read-only', () => {
    expect(isReadonlyCommand('rm -rf /')).toBe(false)
    expect(isReadonlyCommand('npm install')).toBe(false)
    expect(READONLY_SHELL.has('rm')).toBe(false)
  })
})

describe('breakers', () => {
  it('flags destructive commands', () => {
    expect(destructiveBreaker('rm -rf /tmp')).toBe(true)
    expect(destructiveBreaker('ls')).toBe(false)
  })

  it('flags privilege-escalating commands', () => {
    expect(escapingBreaker('sudo vim x')).toBe(true)
    expect(escapingBreaker('cat x')).toBe(false)
  })

  it('checks every sub-command of a compound line', () => {
    expect(shellBreakers.some((b) => b('ls && rm -rf /'))).toBe(true)
    expect(shellBreakers.every((b) => b('ls && cat x'))).toBe(false)
  })
})

describe('modeIndicator', () => {
  it('labels non-interactive modes and stays quiet in interactive', () => {
    expect(modeIndicator('interactive')).toBe('')
    expect(modeIndicator('auto')).toBe('[auto]')
    expect(modeIndicator('plan')).toBe('[plan]')
  })
})
