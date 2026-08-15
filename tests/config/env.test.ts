import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadEnvFile } from '../../src/config/env.ts'

const TEST_KEY = 'PCODE_TEST_ENV_LOADED'

let dir: string
let envPath: string
let previous: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pcode-env-'))
  envPath = join(dir, '.env')
  previous = process.env[TEST_KEY]
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (previous === undefined) delete process.env[TEST_KEY]
  else process.env[TEST_KEY] = previous
})

describe('loadEnvFile', () => {
  it('loads keys from the file into process.env', () => {
    writeFileSync(envPath, `${TEST_KEY}=loaded-value\n`)
    loadEnvFile(envPath)
    expect(process.env[TEST_KEY]).toBe('loaded-value')
  })

  it('parses dotenv syntax (comments, quotes, export prefix)', () => {
    writeFileSync(
      envPath,
      `# comment\n${TEST_KEY}="quoted value" # trailing\nexport ${TEST_KEY}_2=plain\n`,
    )
    loadEnvFile(envPath)
    expect(process.env[TEST_KEY]).toBe('quoted value')
    expect(process.env[`${TEST_KEY}_2`]).toBe('plain')
  })

  it('does not override a variable already in the environment', () => {
    process.env[TEST_KEY] = 'real'
    writeFileSync(envPath, `${TEST_KEY}=from-file\n`)
    loadEnvFile(envPath)
    expect(process.env[TEST_KEY]).toBe('real')
  })

  it('is a no-op when the file is missing', () => {
    expect(() => loadEnvFile(join(dir, 'missing.env'))).not.toThrow()
  })
})
