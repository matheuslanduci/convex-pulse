// Generated from transport.svelte.ts. Run pnpm build:svelte-runes.
import { makeFunctionReference } from "convex/server";
import { getDisabledPaginationSnapshot } from "#client/Pagination.js";
import { skipToken } from "#client/QueryOptions.js";
import {
  createPreloadedQuery,
  preloadedQueryArgs,
  preloadedQueryResult
} from "#http/index.js";
import { createQuery } from "#svelte/index.js";
import { getConvexClient } from "#svelte/lifecycle.js";
import { ConvexLoadPaginatedResult } from "#sveltekit/ConvexLoadPaginatedResult.js";
import { ConvexLoadResult } from "#sveltekit/ConvexLoadResult.js";
import { createConvexHttpClient } from "#sveltekit/http.js";
const isBrowser = globalThis.document !== void 0;
import { ConvexLoadPaginatedResult as ConvexLoadPaginatedResult2 } from "#sveltekit/ConvexLoadPaginatedResult.js";
import { ConvexLoadResult as ConvexLoadResult2 } from "#sveltekit/ConvexLoadResult.js";
async function convexLoad(query, args, options = {}) {
  if (args === skipToken) {
    return disabledQueryState;
  }
  if (isBrowser) {
    const initialData = await getConvexClient().prefetch(query, args).ready;
    return createDetachedQuery(query, args, initialData);
  }
  const data = await createConvexHttpClient(options).query(query, { args });
  return new ConvexLoadResult(createPreloadedQuery(query, args, data));
}
async function convexLoadPaginated(query, args, options) {
  if (args === skipToken) {
    return disabledPaginatedState();
  }
  const queryArgs = {
    ...args,
    paginationOpts: { cursor: null, numItems: options.initialNumItems }
  };
  if (isBrowser) {
    const initialData = await getConvexClient().prefetch(query, queryArgs).ready;
    return createDetachedPaginatedQuery(
      query,
      args,
      options.initialNumItems,
      initialData
    );
  }
  const data = await createConvexHttpClient(options).query(query, {
    args: queryArgs
  });
  return new ConvexLoadPaginatedResult(
    createPreloadedQuery(query, queryArgs, data),
    options.initialNumItems
  );
}
function encodeConvexLoad(value) {
  if (!(value instanceof ConvexLoadResult)) {
    return false;
  }
  return value.preloaded;
}
function decodeConvexLoad(encoded) {
  const query = makeFunctionReference(encoded._name);
  return createDetachedQuery(
    query,
    preloadedQueryArgs(encoded),
    preloadedQueryResult(encoded)
  );
}
function encodeConvexLoadPaginated(value) {
  if (!(value instanceof ConvexLoadPaginatedResult)) {
    return false;
  }
  return {
    initialNumItems: value.initialNumItems,
    preloaded: value.preloaded
  };
}
function decodeConvexLoadPaginated(encoded) {
  const query = makeFunctionReference(
    encoded.preloaded._name
  );
  const queryArgs = preloadedQueryArgs(encoded.preloaded);
  const { paginationOpts: _, ...args } = queryArgs;
  return createDetachedPaginatedQuery(
    query,
    args,
    encoded.initialNumItems,
    preloadedQueryResult(encoded.preloaded)
  );
}
function createDetachedQuery(query, args, initialData) {
  let snapshot = $state(
    successQuerySnapshot(initialData)
  );
  const store = createQuery(getConvexClient(), query, { args });
  store.subscribe((next) => {
    if (next.status !== "pending") {
      snapshot = next;
    }
  });
  return {
    get data() {
      return snapshot.data;
    },
    get error() {
      return snapshot.error;
    },
    get isLoading() {
      return snapshot.isLoading;
    },
    get isStale() {
      return false;
    },
    get status() {
      return snapshot.status;
    }
  };
}
function createDetachedPaginatedQuery(query, args, initialNumItems, initialData) {
  let snapshot = $state(
    successPaginatedSnapshot(initialData)
  );
  const store = createQuery(getConvexClient(), query, {
    args,
    pagination: { initialNumItems }
  });
  store.subscribe((next) => {
    if (next.status !== "pending") {
      snapshot = next;
    }
  });
  return {
    get canLoadMore() {
      return snapshot.canLoadMore;
    },
    get data() {
      return snapshot.data;
    },
    get error() {
      return snapshot.error;
    },
    get isLoading() {
      return snapshot.isLoading;
    },
    get isLoadingMore() {
      return snapshot.isLoadingMore;
    },
    get isStale() {
      return false;
    },
    get loadMore() {
      return snapshot.loadMore;
    },
    get status() {
      return snapshot.status;
    }
  };
}
function successQuerySnapshot(data) {
  return { data, error: null, isLoading: false, status: "success" };
}
function successPaginatedSnapshot(result) {
  return {
    canLoadMore: !result.isDone,
    data: result.page,
    error: null,
    isLoading: false,
    isLoadingMore: false,
    loadMore: noop,
    status: "success"
  };
}
function disabledPaginatedState() {
  return { ...getDisabledPaginationSnapshot(), isStale: false };
}
function noop() {
}
const disabledQueryState = {
  data: void 0,
  error: null,
  isLoading: false,
  isStale: false,
  status: "disabled"
};
export {
  ConvexLoadPaginatedResult2 as ConvexLoadPaginatedResult,
  ConvexLoadResult2 as ConvexLoadResult,
  convexLoad,
  convexLoadPaginated,
  decodeConvexLoad,
  decodeConvexLoadPaginated,
  encodeConvexLoad,
  encodeConvexLoadPaginated
};
