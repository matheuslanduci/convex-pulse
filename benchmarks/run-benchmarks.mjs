import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parseEnv } from 'node:util'

const packageDirectory = import.meta.dirname
const clerkApplicationId = process.env.CLERK_E2E_APP_ID

function resolveBinary(name) {
  const localBinary = path.resolve(packageDirectory, 'node_modules/.bin', name)
  return existsSync(localBinary)
    ? localBinary
    : path.resolve(packageDirectory, '../node_modules/.bin', name)
}

function quoteShellArgument(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageDirectory,
    stdio: 'inherit',
    ...options
  })
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 1}`)
  }
  return result
}

function runJson(command, args) {
  const result = run(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit']
  })
  return JSON.parse(result.stdout)
}

function createClerkFixture() {
  if (clerkApplicationId === undefined) {
    throw new Error('CLERK_E2E_APP_ID is required for authenticated benchmarks')
  }

  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), 'convex-pulse-benchmark-clerk-')
  )
  const clerkEnvFile = path.join(temporaryDirectory, '.env.clerk')
  let secretKey
  let sessionId
  let userId

  function cleanup() {
    try {
      if (secretKey !== undefined && sessionId !== undefined) {
        run(
          'clerk',
          [
            'api',
            '--secret-key',
            secretKey,
            `/sessions/${sessionId}/revoke`,
            '--method',
            'POST',
            '--yes'
          ],
          { stdio: 'ignore' }
        )
      }
    } finally {
      try {
        if (secretKey !== undefined && userId !== undefined) {
          run(
            'clerk',
            [
              'api',
              '--secret-key',
              secretKey,
              `/users/${userId}`,
              '--method',
              'DELETE',
              '--yes'
            ],
            { stdio: 'ignore' }
          )
        }
      } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true })
      }
    }
  }

  try {
    run('clerk', [
      'env',
      'pull',
      '--app',
      clerkApplicationId,
      '--file',
      clerkEnvFile
    ])
    secretKey = parseEnv(readFileSync(clerkEnvFile, 'utf-8')).CLERK_SECRET_KEY
    if (secretKey === undefined) {
      throw new Error('Clerk did not return a secret key')
    }
    const templates = runJson('clerk', [
      'api',
      '--secret-key',
      secretKey,
      '/jwt_templates'
    ])
    if (!templates.some((template) => template.name === 'convex')) {
      throw new Error(
        `Clerk application ${clerkApplicationId} needs a "convex" JWT template`
      )
    }
    const fixtureId = randomUUID()
    const user = runJson('clerk', [
      'users',
      '--secret-key',
      secretKey,
      'create',
      '--data',
      JSON.stringify({
        email_address: [`convex-pulse-${fixtureId}+clerk_test@example.com`],
        external_id: fixtureId,
        first_name: 'Pulse',
        last_name: 'Benchmark',
        skip_password_requirement: true
      }),
      '--yes',
      '--json'
    ])
    userId = user.id
    const session = runJson('clerk', [
      'api',
      '--secret-key',
      secretKey,
      '/sessions',
      '--data',
      JSON.stringify({ user_id: user.id }),
      '--yes'
    ])
    sessionId = session.id
    const token = runJson('clerk', [
      'api',
      '--secret-key',
      secretKey,
      `/sessions/${session.id}/tokens/convex`,
      '--method',
      'POST',
      '--yes'
    ]).jwt
    if (typeof token !== 'string') {
      throw new TypeError('Clerk did not return a JWT')
    }
    const [, payload] = token.split('.')
    if (payload === undefined) {
      throw new Error('Clerk returned an invalid JWT')
    }
    const issuer = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8')
    ).iss
    if (typeof issuer !== 'string') {
      throw new TypeError('Clerk JWT does not contain an issuer')
    }
    return { cleanup, issuer, secretKey, sessionId, token }
  } catch (error) {
    cleanup()
    throw error
  }
}

function createSelfHostedEnvironment() {
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), 'convex-pulse-benchmark-')
  )
  const envFile = path.join(temporaryDirectory, '.env.benchmark.self-hosted')
  const compose = [
    'compose',
    '--file',
    path.resolve(packageDirectory, 'docker-compose.yml'),
    '--project-name',
    'pulse-benchmark'
  ]
  try {
    run('docker', [...compose, 'up', '--detach', '--wait'])
    const adminKey = run(
      'docker',
      [...compose, 'exec', '--no-TTY', 'backend', './generate_admin_key.sh'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'inherit']
      }
    ).stdout.trim()
    if (adminKey.length === 0) {
      throw new Error('The self-hosted backend did not generate an admin key')
    }
    writeFileSync(
      envFile,
      [
        'CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210',
        `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`,
        'CONVEX_URL=http://127.0.0.1:3210',
        'CONVEX_SITE_URL=http://127.0.0.1:3211',
        ''
      ].join('\n'),
      { mode: 0o600 }
    )
  } catch (error) {
    run('docker', [...compose, 'down', '--volumes', '--remove-orphans'])
    rmSync(temporaryDirectory, { force: true, recursive: true })
    throw error
  }
  return {
    cleanup() {
      run('docker', [...compose, 'down', '--volumes', '--remove-orphans'])
      rmSync(temporaryDirectory, { force: true, recursive: true })
    },
    envFile
  }
}

const [target, suite = 'node'] = process.argv.slice(2)
if (target !== 'cloud' && target !== 'local' && target !== 'self-hosted') {
  throw new Error(
    'Expected the benchmark target to be "cloud", "local", or "self-hosted"'
  )
}
if (
  suite !== 'all' &&
  suite !== 'node' &&
  suite !== 'react' &&
  suite !== 'vue'
) {
  throw new Error(
    'Expected the benchmark suite to be "all", "node", "react", or "vue"'
  )
}

const convex = resolveBinary('convex')
const playwright = resolveBinary('playwright')
const defaultEnvFile = path.resolve(packageDirectory, '.env.local')
const defaultEnvironment = existsSync(defaultEnvFile)
  ? readFileSync(defaultEnvFile, 'utf-8')
  : undefined
const nodeBenchmarkCommand = [
  quoteShellArgument(process.execPath),
  '--experimental-strip-types',
  quoteShellArgument(path.resolve(packageDirectory, 'src/run.ts'))
].join(' ')
const reactBenchmarkCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'react/playwright.config.ts')
  )
].join(' ')
const vueBenchmarkCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(path.resolve(packageDirectory, 'vue/playwright.config.ts'))
].join(' ')
let benchmarkCommand = vueBenchmarkCommand
if (suite === 'all') {
  benchmarkCommand = `${nodeBenchmarkCommand} && ${reactBenchmarkCommand} && ${vueBenchmarkCommand}`
} else if (suite === 'node') {
  benchmarkCommand = nodeBenchmarkCommand
} else if (suite === 'react') {
  benchmarkCommand = reactBenchmarkCommand
}
let selfHostedEnvironment
let clerkFixture

try {
  clerkFixture = createClerkFixture()
  selfHostedEnvironment =
    target === 'self-hosted' ? createSelfHostedEnvironment() : undefined
  const envFile =
    selfHostedEnvironment?.envFile ??
    path.resolve(packageDirectory, `.env.benchmark.${target}`)
  if (!existsSync(envFile)) {
    throw new Error(
      `Benchmarks are not configured for ${target}. Create ${path.basename(envFile)} from its example file.`
    )
  }
  const deploymentEnvironment = parseEnv(readFileSync(envFile, 'utf-8'))
  const environment = {
    ...process.env,
    ...deploymentEnvironment,
    BENCHMARK_CLERK_SECRET_KEY: clerkFixture.secretKey,
    BENCHMARK_CLERK_SESSION_ID: clerkFixture.sessionId,
    CLERK_JWT_ISSUER_DOMAIN: clerkFixture.issuer,
    VITE_BENCHMARK_TOKEN: clerkFixture.token,
    VITE_CONVEX_URL: deploymentEnvironment.CONVEX_URL
  }
  run(
    convex,
    [
      'env',
      'set',
      'CLERK_JWT_ISSUER_DOMAIN',
      clerkFixture.issuer,
      '--env-file',
      envFile
    ],
    { env: environment }
  )
  run(
    convex,
    [
      'dev',
      '--once',
      '--env-file',
      envFile,
      '--start',
      benchmarkCommand,
      '--tail-logs',
      'disable'
    ],
    { env: environment }
  )
} finally {
  if (defaultEnvironment !== undefined) {
    writeFileSync(defaultEnvFile, defaultEnvironment)
  }
  selfHostedEnvironment?.cleanup()
  clerkFixture?.cleanup()
}
