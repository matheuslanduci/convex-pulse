import type { ReactNode } from 'react'

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

type RootLayoutProps = Readonly<{ children: ReactNode }>
