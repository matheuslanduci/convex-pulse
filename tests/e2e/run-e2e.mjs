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
const configuredClerkSecretKey = process.env.CLERK_SECRET_KEY

function resolveBinary(name) {
  const localBinary = path.resolve(packageDirectory, 'node_modules/.bin', name)

  if (existsSync(localBinary)) {
    return localBinary
  }

  return path.resolve(packageDirectory, '../../node_modules/.bin', name)
}

function quoteShellArgument(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

const [target, suite = 'all'] = process.argv.slice(2)

if (
  target !== 'cloud' &&
  target !== 'local' &&
  target !== 'remote-docker' &&
  target !== 'self-hosted'
) {
  throw new Error(
    'Expected the E2E target to be "cloud", "local", "remote-docker", or "self-hosted"'
  )
}

if (
  suite !== 'all' &&
  suite !== 'angular' &&
  suite !== 'nextjs' &&
  suite !== 'node' &&
  suite !== 'react' &&
  suite !== 'solid' &&
  suite !== 'svelte' &&
  suite !== 'sveltekit' &&
  suite !== 'tanstack-start' &&
  suite !== 'vue'
) {
  throw new Error(
    'Expected the E2E suite to be "all", "angular", "nextjs", "node", "react", "solid", "svelte", "sveltekit", "tanstack-start", or "vue"'
  )
}

const defaultEnvFile = path.resolve(packageDirectory, '.env.local')
const defaultEnvironment = existsSync(defaultEnvFile)
  ? readFileSync(defaultEnvFile, 'utf-8')
  : undefined
const clerk = resolveBinary('clerk')
const convex = resolveBinary('convex')
const playwright = resolveBinary('playwright')
const vitest = resolveBinary('vitest')
const repositoryDirectory = path.resolve(packageDirectory, '../..')
const vitestConfig = path.resolve(repositoryDirectory, 'vitest.config.ts')
const nodeTestCommand = [
  quoteShellArgument(vitest),
  'run',
  '--root',
  quoteShellArgument(repositoryDirectory),
  '--config',
  quoteShellArgument(vitestConfig),
  '--project',
  'e2e',
  '--coverage',
  ...(target === 'remote-docker' ? ['--testTimeout', '15000'] : [])
].join(' ')
const angularTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'angular/playwright.config.ts')
  )
].join(' ')
const nextjsTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'nextjs/playwright.config.ts')
  )
].join(' ')
const reactTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'react/playwright.config.ts')
  )
].join(' ')
const solidTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'solid/playwright.config.ts')
  )
].join(' ')
const svelteTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'svelte/playwright.config.ts')
  )
].join(' ')
const sveltekitTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'sveltekit/playwright.config.ts')
  )
].join(' ')
const tanstackStartTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(
    path.resolve(packageDirectory, 'tanstack-start/playwright.config.ts')
  )
].join(' ')
const vueTestCommand = [
  quoteShellArgument(playwright),
  'test',
  '--config',
  quoteShellArgument(path.resolve(packageDirectory, 'vue/playwright.config.ts'))
].join(' ')
let testCommand = vueTestCommand
if (suite === 'all') {
  testCommand = `${nodeTestCommand} && ${angularTestCommand} && ${nextjsTestCommand} && ${reactTestCommand} && ${solidTestCommand} && ${svelteTestCommand} && ${sveltekitTestCommand} && ${tanstackStartTestCommand} && ${vueTestCommand}`
} else if (suite === 'angular') {
  testCommand = angularTestCommand
} else if (suite === 'nextjs') {
  testCommand = nextjsTestCommand
} else if (suite === 'node') {
  testCommand = nodeTestCommand
} else if (suite === 'react') {
  testCommand = reactTestCommand
} else if (suite === 'solid') {
  testCommand = solidTestCommand
} else if (suite === 'svelte') {
  testCommand = svelteTestCommand
} else if (suite === 'sveltekit') {
  testCommand = sveltekitTestCommand
} else if (suite === 'tanstack-start') {
  testCommand = tanstackStartTestCommand
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

function runJson(command, args, options = {}) {
  const result = run(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options
  })

  return JSON.parse(result.stdout)
}

function createClerkFixture() {
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), 'convex-pulse-clerk-')
  )
  const clerkEnvFile = path.join(temporaryDirectory, '.env.clerk')
  let secretKey
  let sessionId
  let userId

  function cleanup() {
    try {
      if (secretKey !== undefined && sessionId !== undefined) {
        run(
          clerk,
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
            clerk,
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
    secretKey = configuredClerkSecretKey
    if (secretKey === undefined) {
      if (clerkApplicationId === undefined) {
        throw new Error(
          'CLERK_SECRET_KEY or CLERK_E2E_APP_ID is required for E2E tests'
        )
      }

      run(clerk, [
        'env',
        'pull',
        '--app',
        clerkApplicationId,
        '--file',
        clerkEnvFile
      ])
      const clerkEnvironment = parseEnv(readFileSync(clerkEnvFile, 'utf-8'))
      secretKey = clerkEnvironment.CLERK_SECRET_KEY
    }

    if (secretKey === undefined) {
      throw new Error('Clerk did not return a secret key')
    }

    const templates = runJson(clerk, [
      'api',
      '--secret-key',
      secretKey,
      '/jwt_templates'
    ])
    if (!templates.some((template) => template.name === 'convex')) {
      throw new Error('The Clerk E2E application needs a "convex" JWT template')
    }

    const fixtureId = randomUUID()
    const user = runJson(clerk, [
      'users',
      '--secret-key',
      secretKey,
      'create',
      '--data',
      JSON.stringify({
        email_address: [`convex-pulse-${fixtureId}+clerk_test@example.com`],
        external_id: fixtureId,
        first_name: 'Pulse',
        last_name: 'E2E',
        skip_password_requirement: true
      }),
      '--yes',
      '--json'
    ])
    userId = user.id
    const session = runJson(clerk, [
      'api',
      '--secret-key',
      secretKey,
      '/sessions',
      '--data',
      JSON.stringify({ user_id: user.id }),
      '--yes'
    ])
    sessionId = session.id
    const token = createClerkToken(secretKey, session.id)
    const freshToken = createClerkToken(secretKey, session.id)
    const issuer = decodeJwtIssuer(token)

    return {
      cleanup,
      freshToken,
      issuer,
      token,
      userId: user.id
    }
  } catch (error) {
    cleanup()
    throw error
  }
}

function createClerkToken(secretKey, sessionId) {
  const token = runJson(clerk, [
    'api',
    '--secret-key',
    secretKey,
    `/sessions/${sessionId}/tokens/convex`,
    '--method',
    'POST',
    '--yes'
  ])

  if (typeof token.jwt !== 'string') {
    throw new TypeError('Clerk did not return a JWT')
  }
  return token.jwt
}

function decodeJwtIssuer(token) {
  const [, payload] = token.split('.')
  if (payload === undefined) {
    throw new Error('Clerk returned an invalid JWT')
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  if (typeof claims.iss !== 'string') {
    throw new TypeError('Clerk JWT does not contain an issuer')
  }
  return claims.iss
}

function createSelfHostedEnvironment() {
  const temporaryDirectory = mkdtempSync(
    path.join(os.tmpdir(), 'convex-pulse-e2e-')
  )
  const envFile = path.join(temporaryDirectory, '.env.e2e.self-hosted')
  const composeFile = path.resolve(packageDirectory, 'docker-compose.yml')
  const compose = [
    'compose',
    '--file',
    composeFile,
    '--project-name',
    'pulse-e2e'
  ]

  try {
    run('docker', [...compose, 'up', '--detach', '--wait'])

    const keyResult = run(
      'docker',
      [...compose, 'exec', '--no-TTY', 'backend', './generate_admin_key.sh'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }
    )
    const adminKey = keyResult.stdout.trim()

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

function createAnonymousLocalEnvironment() {
  rmSync(defaultEnvFile, { force: true })
  run(convex, ['init'], {
    env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous' }
  })

  return defaultEnvFile
}

let selfHostedEnvironment
let clerkFixture

try {
  clerkFixture = createClerkFixture()
  selfHostedEnvironment =
    target === 'self-hosted' ? createSelfHostedEnvironment() : undefined
  const envFile =
    selfHostedEnvironment?.envFile ??
    (target === 'local' && process.env.CONVEX_AGENT_MODE === 'anonymous'
      ? createAnonymousLocalEnvironment()
      : path.resolve(packageDirectory, `.env.e2e.${target}`))
  const deploymentEnvironment = parseEnv(readFileSync(envFile, 'utf-8'))
  const testEnvironment = {
    ...process.env,
    ...deploymentEnvironment,
    CLERK_E2E_FRESH_TOKEN: clerkFixture.freshToken,
    CLERK_E2E_TOKEN: clerkFixture.token,
    CLERK_E2E_USER_ID: clerkFixture.userId,
    CLERK_JWT_ISSUER_DOMAIN: clerkFixture.issuer,
    NEXT_PUBLIC_CONVEX_URL: deploymentEnvironment.CONVEX_URL,
    PUBLIC_CONVEX_URL: deploymentEnvironment.CONVEX_URL,
    VITE_CLERK_E2E_TOKEN: clerkFixture.token,
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
    { env: testEnvironment }
  )

  run(
    convex,
    [
      'dev',
      '--once',
      '--env-file',
      envFile,
      '--start',
      testCommand,
      '--tail-logs',
      'disable'
    ],
    {
      env: testEnvironment
    }
  )
} finally {
  if (defaultEnvironment === undefined) {
    rmSync(defaultEnvFile, { force: true })
  } else {
    writeFileSync(defaultEnvFile, defaultEnvironment)
  }
  selfHostedEnvironment?.cleanup()
  clerkFixture?.cleanup()
}
