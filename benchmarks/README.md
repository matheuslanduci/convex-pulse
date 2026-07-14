# Node, React, and Vue client benchmarks

This package compares `convex-js` with `convex-pulse` in Node and React against the same Convex deployment and generated function references. Both clients authenticate with the same short-lived Clerk fixture, and every benchmark function requires an authenticated identity.

It measures query, mutation, and action behavior:

- Sequential latency: mean, p50, p95, and p99.
- Concurrent throughput: completed operations per second.
- Client-process CPU time per operation for latency and throughput workloads.
- Client setup/enqueue time separated from asynchronous server/transport wait time.
- Memory: connected-client baseline, peak workload growth, and memory retained after `close()`.

The React benchmark runs equivalent `convex-js` and `convex-pulse` providers and hooks in Chromium. It measures initial query-to-render and mutation-to-render latency using the browser performance clock.

The Vue benchmark uses the community-maintained `convex-vue` package as the comparison client and exercises both clients through their Vue plugins, reactive query state, and mutation composables in Chromium.

Each sample runs in a fresh Node process with `--expose-gc`. Client order is alternated between runs, warmups are excluded, and every operation receives unique arguments so query caching cannot turn the comparison into local cache lookups.

## Run

Copy the environment template for each target you want to use and fill it with that deployment's values:

```bash
cp benchmarks/.env.benchmark.local.example benchmarks/.env.benchmark.local
cp benchmarks/.env.benchmark.cloud.example benchmarks/.env.benchmark.cloud
```

The runner uses the Clerk CLI to create and clean up a temporary user and session. It defaults to the same Clerk application as E2E; set `CLERK_E2E_APP_ID` to use another application. The application must have a `convex` JWT template.

Run a target from the repository root:

```bash
pnpm benchmark:node:local
pnpm benchmark:node:docker
pnpm benchmark:node:cloud
pnpm benchmark:react:local
pnpm benchmark:react:docker
pnpm benchmark:react:cloud
pnpm benchmark:vue:local
pnpm benchmark:vue:docker
pnpm benchmark:vue:cloud
```

`pnpm benchmark:node` is an alias for the local target. The Docker target starts and removes its own self-hosted Convex backend and does not require an environment file.

The defaults are four isolated samples per client, 100 sequential operations per latency test, and 500 operations per throughput test at concurrency 25.

## Configuration

Set any of these environment variables before running:

| Variable | Default | Meaning |
| --- | --: | --- |
| `BENCHMARK_RUNS` | 4 | Isolated process samples per client |
| `BENCHMARK_WARMUP_ITERATIONS` | 25 | Unmeasured warmups per operation |
| `BENCHMARK_LATENCY_ITERATIONS` | 100 | Sequential samples per operation |
| `BENCHMARK_THROUGHPUT_OPERATIONS` | 500 | Total operations per throughput test |
| `BENCHMARK_CONCURRENCY` | 25 | Concurrent throughput lanes |
| `BENCHMARK_PAYLOAD_BYTES` | 128 | Echo payload size |
| `BENCHMARK_OUTPUT` |  | Optional raw JSON output path |
| `BENCHMARK_REACT_WARMUPS` | 5 | Unmeasured browser page samples per client |
| `BENCHMARK_REACT_ITERATIONS` | 20 | Measured browser page samples per client |
| `BENCHMARK_VUE_WARMUPS` | 5 | Unmeasured Vue browser page samples per client |
| `BENCHMARK_VUE_ITERATIONS` | 20 | Measured Vue browser page samples per client |

For a quick smoke run:

```bash
BENCHMARK_RUNS=1 \
BENCHMARK_WARMUP_ITERATIONS=2 \
BENCHMARK_LATENCY_ITERATIONS=5 \
BENCHMARK_THROUGHPUT_OPERATIONS=20 \
pnpm benchmark:node
```

These results compare client overhead on one machine. They are not a benchmark of Convex server capacity or internet performance.
