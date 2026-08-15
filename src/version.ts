import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Single source of truth for the CLI version: read package.json so `--version`
// and npm metadata can never drift apart.
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')

export const VERSION: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version
