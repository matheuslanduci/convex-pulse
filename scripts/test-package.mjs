import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf-8')
)
const temporaryDirectory = mkdtempSync(
  path.join(tmpdir(), 'convex-pulse-package-')
)

try {
  execFileSync('pnpm', ['pack', '--pack-destination', temporaryDirectory], {
    cwd: root,
    stdio: 'inherit'
  })

  const archiveName = `${packageJson.name.replace('@', '').replace('/', '-')}-${packageJson.version}.tgz`
  const archivePath = path.join(temporaryDirectory, archiveName)
  const archiveFileList = execFileSync('tar', ['-tzf', archivePath], {
    encoding: 'utf-8'
  })

  assertPackageFiles(archiveFileList)

  const consumerDirectory = path.join(temporaryDirectory, 'consumer')
  mkdirSync(consumerDirectory)
  const consumerPackageJson = {
    dependencies: {
      '@angular/core': packageJson.devDependencies['@angular/core'],
      '@types/react': packageJson.devDependencies['@types/react'],
      convex: packageJson.devDependencies.convex,
      'convex-pulse': `file:${archivePath}`,
      react: packageJson.devDependencies.react,
      rxjs: packageJson.devDependencies.rxjs,
      'solid-js': packageJson.devDependencies['solid-js'],
      svelte: packageJson.devDependencies.svelte,
      typescript: packageJson.devDependencies.typescript,
      vue: packageJson.devDependencies.vue
    },
    name: 'convex-pulse-package-consumer',
    private: true,
    type: 'module',
    version: '0.0.0'
  }

  writeFileSync(
    path.join(consumerDirectory, 'package.json'),
    `${JSON.stringify(consumerPackageJson, null, 2)}\n`
  )
  writeFileSync(
    path.join(consumerDirectory, 'index.ts'),
    `import * as pulse from 'convex-pulse'
import type { QueryPaginationOptions } from 'convex-pulse'
import * as angular from 'convex-pulse/angular'
import * as devtools from 'convex-pulse/devtools'
import * as http from 'convex-pulse/http'
import * as nextjs from 'convex-pulse/nextjs'
import * as react from 'convex-pulse/react'
import * as solid from 'convex-pulse/solid'
import * as svelte from 'convex-pulse/svelte'
import * as sveltekit from 'convex-pulse/sveltekit'
import * as sveltekitServer from 'convex-pulse/sveltekit/server'
import * as vue from 'convex-pulse/vue'

type PaginationOptions = QueryPaginationOptions<any>

const paginationOptions = null as unknown as PaginationOptions

void [
  pulse,
  angular,
  devtools,
  http,
  nextjs,
  paginationOptions,
  react,
  solid,
  svelte,
  sveltekit,
  sveltekitServer,
  vue
]
`
  )
  writeFileSync(
    path.join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          noEmit: true,
          strict: true,
          target: 'es2022'
        },
        include: ['index.ts']
      },
      null,
      2
    )}\n`
  )

  execFileSync('pnpm', ['install', '--ignore-scripts'], {
    cwd: consumerDirectory,
    stdio: 'inherit'
  })
  execFileSync('pnpm', ['exec', 'tsc'], {
    cwd: consumerDirectory,
    stdio: 'inherit'
  })
  execFileSync(
    'node',
    [
      '--input-type=module',
      '--eval',
      `await Promise.all([
        import('convex-pulse'),
        import('convex-pulse/angular'),
        import('convex-pulse/devtools'),
        import('convex-pulse/http'),
        import('convex-pulse/nextjs'),
        import('convex-pulse/react'),
        import('convex-pulse/solid'),
        import('convex-pulse/svelte'),
        import('convex-pulse/sveltekit'),
        import('convex-pulse/sveltekit/server'),
        import('convex-pulse/vue')
      ])`
    ],
    { cwd: consumerDirectory, stdio: 'inherit' }
  )
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}

function assertPackageFiles(archiveFileList) {
  const requiredFileList = [
    'package/LICENSE',
    'package/README.md',
    'package/dist/index.d.ts',
    'package/dist/index.js',
    'package/package.json'
  ]

  for (const requiredFile of requiredFileList) {
    if (!archiveFileList.includes(requiredFile)) {
      throw new Error(`Packed package is missing ${requiredFile}`)
    }
  }

  const packagedFileList = archiveFileList.trim().split('\n')
  const unexpectedFileList = packagedFileList.filter(
    (file) =>
      file !== 'package/LICENSE' &&
      file !== 'package/README.md' &&
      file !== 'package/package.json' &&
      !file.startsWith('package/dist/')
  )

  if (unexpectedFileList.length > 0) {
    throw new Error(
      `Packed package contains unexpected files:\n${unexpectedFileList.join('\n')}`
    )
  }
}
