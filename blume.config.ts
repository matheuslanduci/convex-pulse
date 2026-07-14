import { defineConfig } from 'blume'

export default defineConfig({
  content: {
    include: ['docs/**/*.{md,mdx}', 'changelog/**/*.{md,mdx}'],
    root: '.'
  },
  description: 'A faster, reactive Convex client for TypeScript.',
  examples: 'docs/examples',
  logo: '/convex-pulse.svg',
  navigation: {
    tabs: [
      { label: 'Docs', path: '/docs' },
      { label: 'Changelog', path: '/changelog' }
    ]
  },
  title: 'Convex Pulse'
})
