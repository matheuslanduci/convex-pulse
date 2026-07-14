import type { Preview } from '@storybook/react-vite'

const preview: Preview = {
  parameters: {
    a11y: {
      test: 'error'
    },
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: '#f3f4f6' },
        { name: 'dark', value: '#111217' }
      ]
    },
    layout: 'fullscreen'
  }
}

export default preview
