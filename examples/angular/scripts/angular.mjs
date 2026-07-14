import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import process, { loadEnvFile } from 'node:process'

if (existsSync('.env.local')) loadEnvFile('.env.local')

const command = process.argv[2]
if (command !== 'build' && command !== 'serve') {
  throw new Error('Expected the Angular command to be "build" or "serve"')
}

const convexUrl = process.env.CONVEX_URL ?? 'http://127.0.0.1:3210'
const angular = spawn(
  'pnpm',
  [
    'exec',
    'ng',
    command,
    '--define',
    `CONVEX_URL=${JSON.stringify(convexUrl)}`
  ],
  { stdio: 'inherit' }
)

angular.on('exit', (code) => process.exit(code ?? 1))
