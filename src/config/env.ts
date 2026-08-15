import { existsSync } from 'node:fs'

// Node's built-in loader gives dotenv semantics: comments, quotes, `export`
// prefix, and no override of variables already present in the environment.
export function loadEnvFile(path: string): void {
  if (existsSync(path)) process.loadEnvFile(path)
}
