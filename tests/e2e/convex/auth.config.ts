import type { AuthConfig } from 'convex/server'

const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN

if (issuer === undefined) {
  throw new Error('CLERK_JWT_ISSUER_DOMAIN is required')
}

export default {
  providers: [
    {
      applicationID: 'convex',
      domain: issuer
    }
  ]
} satisfies AuthConfig
