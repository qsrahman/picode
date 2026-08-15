#!/usr/bin/env node

import { HELP_TEXT } from './cli/help.ts'
import { VERSION } from './version.ts'

// Phase 0 smoke entry: proves the Node 26 + type-stripping toolchain runs and
// wires version/help output. Formal flag parsing and dispatch land in Phase 1
// (src/cli/args.ts); until then every invocation prints version or help.
const args = process.argv.slice(2)

if (args.includes('--version')) {
  process.stdout.write(`pcode ${VERSION}\n`)
} else {
  process.stdout.write(HELP_TEXT)
}
