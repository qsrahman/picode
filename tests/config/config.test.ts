import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveConfig } from '../../src/config/config.ts'
import { ConfigError } from '../../src/errors.ts'
import { DEFAULT_CONFIG } from '../../src/config/config.ts'

let dir: string
let userPath: string
let projectPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pcode-config-'))
  userPath = join(dir, 'user.json')
  projectPath = join(dir, 'project.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveConfig', () => {
  it('returns defaults when no config files exist', () => {
    const config = resolveConfig(
      {},
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config).toEqual({ ...DEFAULT_CONFIG, root: dir })
  })

  it('applies a project config on top of defaults', () => {
    writeFileSync(projectPath, JSON.stringify({ model: 'gpt-4.1' }))
    const config = resolveConfig(
      {},
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.model).toBe('gpt-4.1')
    expect(config.mode).toBe('interactive')
  })

  it('lets the project config override the user config', () => {
    writeFileSync(userPath, JSON.stringify({ model: 'user-model' }))
    writeFileSync(projectPath, JSON.stringify({ model: 'project-model' }))
    const config = resolveConfig(
      {},
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.model).toBe('project-model')
  })

  it('lets CLI flags override every file', () => {
    writeFileSync(userPath, JSON.stringify({ model: 'user-model' }))
    writeFileSync(projectPath, JSON.stringify({ model: 'project-model' }))
    const config = resolveConfig(
      { model: 'cli-model', mode: 'plan' },
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.model).toBe('cli-model')
    expect(config.mode).toBe('plan')
  })

  it('prefers --config over the project config', () => {
    const explicitPath = join(dir, 'explicit.json')
    writeFileSync(projectPath, JSON.stringify({ model: 'project-model' }))
    writeFileSync(explicitPath, JSON.stringify({ model: 'explicit-model' }))
    const config = resolveConfig(
      { config: explicitPath },
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.model).toBe('explicit-model')
  })

  it('errors when an explicit --config path is missing', () => {
    expect(() =>
      resolveConfig(
        { config: join(dir, 'missing.json') },
        { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
      ),
    ).toThrow(ConfigError)
  })

  it('resolves a relative root against the cwd', () => {
    writeFileSync(projectPath, JSON.stringify({ root: './sub' }))
    const config = resolveConfig(
      {},
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.root).toBe(join(dir, 'sub'))
  })

  it('resolves relative additionalDirs against the cwd', () => {
    writeFileSync(projectPath, JSON.stringify({ additionalDirs: ['./one', './two'] }))
    const config = resolveConfig(
      {},
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.additionalDirs).toEqual([join(dir, 'one'), join(dir, 'two')])
  })

  it('rejects an invalid value in a config file', () => {
    writeFileSync(projectPath, JSON.stringify({ mode: 'bogus' }))
    expect(() =>
      resolveConfig({}, { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath }),
    ).toThrow(/Invalid config/)
  })

  it('rejects malformed JSON with a read error', () => {
    writeFileSync(projectPath, '{ not json')
    expect(() =>
      resolveConfig({}, { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath }),
    ).toThrow(/Failed to read config/)
  })

  it('accepts a user config with a subset of keys', () => {
    writeFileSync(userPath, JSON.stringify({ maxTokens: 4096 }))
    const config = resolveConfig(
      {},
      { cwd: dir, userConfigPath: userPath, projectConfigPath: projectPath },
    )
    expect(config.maxTokens).toBe(4096)
    expect(config.model).toBe(DEFAULT_CONFIG.model)
  })

  it('lets OPENAI_BASE_URL from the env override config files', () => {
    writeFileSync(projectPath, JSON.stringify({ baseURL: 'https://project.example/v1' }))
    const config = resolveConfig(
      {},
      {
        cwd: dir,
        userConfigPath: userPath,
        projectConfigPath: projectPath,
        env: { OPENAI_BASE_URL: 'https://env.example/v1' },
      },
    )
    expect(config.baseURL).toBe('https://env.example/v1')
  })

  it('ignores an empty OPENAI_BASE_URL', () => {
    writeFileSync(projectPath, JSON.stringify({ baseURL: 'https://project.example/v1' }))
    const config = resolveConfig(
      {},
      {
        cwd: dir,
        userConfigPath: userPath,
        projectConfigPath: projectPath,
        env: { OPENAI_BASE_URL: '' },
      },
    )
    expect(config.baseURL).toBe('https://project.example/v1')
  })

  it('lets OPENAI_DEFAULT_MODEL from the env override config files', () => {
    writeFileSync(projectPath, JSON.stringify({ model: 'from-project' }))
    const config = resolveConfig(
      {},
      {
        cwd: dir,
        userConfigPath: userPath,
        projectConfigPath: projectPath,
        env: { OPENAI_DEFAULT_MODEL: 'from-env' },
      },
    )
    expect(config.model).toBe('from-env')
  })

  it('lets the --model CLI flag win over OPENAI_DEFAULT_MODEL', () => {
    const config = resolveConfig(
      { model: 'from-cli' },
      {
        cwd: dir,
        userConfigPath: userPath,
        projectConfigPath: projectPath,
        env: { OPENAI_DEFAULT_MODEL: 'from-env' },
      },
    )
    expect(config.model).toBe('from-cli')
  })
})
