import { ConvexPulseClient } from 'convex-pulse'

import { api } from '#benchmark/api'
import type {
  BenchmarkAuthTokenFetcher,
  BenchmarkClient
} from '#benchmark/types.js'

export function createClient(
  deploymentUrl: string,
  fetchAuthToken: BenchmarkAuthTokenFetcher
): BenchmarkClient {
  const client = new ConvexPulseClient(deploymentUrl)
  client.setAuth(fetchAuthToken)

  return {
    action(input) {
      return client.action(api.benchmark.echoAction, { args: input })
    },
    close() {
      return client.close()
    },
    mutation(input) {
      return client.mutation(api.benchmark.echoMutation, { args: input })
    },
    query(input) {
      return client.query(api.benchmark.echoQuery, { args: input })
    }
  }
}
