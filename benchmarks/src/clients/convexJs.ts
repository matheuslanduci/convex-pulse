import { ConvexClient } from 'convex/browser'

import { api } from '#benchmark/api'
import type {
  BenchmarkAuthTokenFetcher,
  BenchmarkClient
} from '#benchmark/types.js'

export function createClient(
  deploymentUrl: string,
  fetchAuthToken: BenchmarkAuthTokenFetcher
): BenchmarkClient {
  const client = new ConvexClient(deploymentUrl)
  client.setAuth(fetchAuthToken)

  return {
    action(input) {
      return client.action(api.benchmark.echoAction, input)
    },
    close() {
      return client.close()
    },
    mutation(input) {
      return client.mutation(api.benchmark.echoMutation, input)
    },
    query(input) {
      return client.query(api.benchmark.echoQuery, input)
    }
  }
}
