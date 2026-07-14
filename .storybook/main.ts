import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  addons: ['@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  viteFinal
}

export default config

function viteFinal(storybookConfig: Record<string, unknown>) {
  const resolve = storybookConfig.resolve as
    | { alias?: Record<string, string> }
    | undefined

  return {
    ...storybookConfig,
    resolve: {
      ...resolve,
      alias: {
        ...resolve?.alias,
        'convex-pulse/devtools': fileURLToPath(
          new URL('../devtools/index.ts', import.meta.url)
        )
      }
    }
  }
}
