// Generated from reactive.svelte.ts. Run pnpm build:svelte-runes.
import { getDisabledPaginationSnapshot } from "#client/Pagination.js";
import { skipToken } from "#client/QueryOptions.js";
import { createQuery } from "#svelte/index.js";
import {
  getAuthContext,
  setAuthContext,
  useConvexClient
} from "#svelte/lifecycle.js";
function useQuery(query, args, options = {}) {
  const client = useConvexClient();
  const initialArgs = resolveArgs(args);
  const initialKey = argsKey(initialArgs);
  let initialDataActive = options.initialData !== void 0;
  let isStale = $state(false);
  let snapshot = $state(
    initialQuerySnapshot(initialArgs, options.initialData)
  );
  $effect(() => {
    const currentArgs = resolveArgs(args);
    const currentKey = argsKey(currentArgs);
    if (currentArgs === skipToken) {
      initialDataActive = false;
      isStale = false;
      snapshot = disabledQuerySnapshot;
      return;
    }
    if (currentKey !== initialKey) {
      initialDataActive = false;
    }
    const queryStore = createQuery(client, query, {
      args: $state.snapshot(currentArgs),
      ...options.onDataChange === void 0 ? {} : { onDataChange: options.onDataChange },
      ...options.retries === void 0 ? {} : { retries: options.retries },
      ...options.select === void 0 ? {} : { select: options.select }
    });
    return queryStore.subscribe((next) => {
      if (next.status === "pending") {
        if (initialDataActive || options.keepPreviousData && snapshot.status === "success") {
          isStale = !initialDataActive;
          return;
        }
      } else {
        initialDataActive = false;
        isStale = false;
      }
      snapshot = next;
    });
  });
  function current() {
    if (options.throwOnError === true && snapshot.status === "error") {
      throw snapshot.error;
    }
    return snapshot;
  }
  return {
    get data() {
      return current().data;
    },
    get error() {
      return current().error;
    },
    get isLoading() {
      return current().isLoading;
    },
    get isStale() {
      current();
      return isStale;
    },
    get status() {
      return current().status;
    }
  };
}
function usePaginatedQuery(query, args, options) {
  const client = useConvexClient();
  const initialArgs = resolvePaginatedArgs(args);
  const initialKey = argsKey(initialArgs);
  let initialDataActive = options.initialData !== void 0;
  let isStale = $state(false);
  let snapshot = $state(
    initialPaginationSnapshot(initialArgs, options.initialData)
  );
  $effect(() => {
    const currentArgs = resolvePaginatedArgs(args);
    const currentKey = argsKey(currentArgs);
    if (currentArgs === skipToken) {
      initialDataActive = false;
      isStale = false;
      snapshot = getDisabledPaginationSnapshot();
      return;
    }
    if (currentKey !== initialKey) {
      initialDataActive = false;
    }
    const queryOptions = {
      args: $state.snapshot(currentArgs),
      ...options.onDataChange === void 0 ? {} : { onDataChange: options.onDataChange },
      pagination: { initialNumItems: options.initialNumItems },
      ...options.retries === void 0 ? {} : { retries: options.retries }
    };
    const queryStore = createQuery(client, query, queryOptions);
    return queryStore.subscribe((next) => {
      if (next.status === "pending") {
        if (initialDataActive || options.keepPreviousData && snapshot.status === "success") {
          isStale = !initialDataActive;
          return;
        }
      } else {
        initialDataActive = false;
        isStale = false;
      }
      snapshot = next;
    });
  });
  function current() {
    if (options.throwOnError === true && snapshot.status === "error") {
      throw snapshot.error;
    }
    return snapshot;
  }
  return {
    get canLoadMore() {
      return current().canLoadMore;
    },
    get data() {
      return current().data;
    },
    get error() {
      return current().error;
    },
    get isLoading() {
      return current().isLoading;
    },
    get isLoadingMore() {
      return current().isLoadingMore;
    },
    get isStale() {
      current();
      return isStale;
    },
    get loadMore() {
      return current().loadMore;
    },
    get status() {
      return current().status;
    }
  };
}
function setupAuth(provider, options = {}) {
  const client = useConvexClient();
  const initialProvider = provider();
  const state = $state({
    isAuthenticated: options.initialState?.isAuthenticated ?? (!initialProvider.isLoading && initialProvider.isAuthenticated),
    isLoading: options.initialState === void 0 ? initialProvider.isLoading : false,
    isRefreshing: false
  });
  const context = {
    get isAuthenticated() {
      return state.isAuthenticated;
    },
    get isLoading() {
      return state.isLoading;
    },
    get isRefreshing() {
      return state.isRefreshing;
    }
  };
  setAuthContext(context);
  $effect(() => {
    const current = provider();
    if (current.isLoading) {
      state.isLoading = true;
      return;
    }
    if (!current.isAuthenticated) {
      client.clearAuth();
      state.isAuthenticated = false;
      state.isLoading = false;
      state.isRefreshing = false;
      return;
    }
    let active = true;
    state.isLoading = true;
    client.setAuth(current.fetchAccessToken, {
      onChange: (isAuthenticated) => {
        if (active) {
          state.isAuthenticated = isAuthenticated;
          state.isLoading = false;
        }
      },
      onRefreshChange: (isRefreshing) => {
        if (active) {
          state.isRefreshing = isRefreshing;
        }
      }
    });
    return () => {
      active = false;
      client.clearAuth();
    };
  });
  return context;
}
function useAuth() {
  const context = getAuthContext();
  if (context === void 0) {
    throw new Error(
      "No Convex Pulse auth state was found in Svelte context. Call setupAuth() in a parent component."
    );
  }
  return context;
}
function resolveArgs(args) {
  return typeof args === "function" ? args() : args;
}
function resolvePaginatedArgs(args) {
  return typeof args === "function" ? args() : args;
}
function argsKey(args) {
  return args === skipToken ? skipToken : JSON.stringify(args);
}
function initialQuerySnapshot(args, initialData) {
  if (args === skipToken) {
    return disabledQuerySnapshot;
  }
  if (initialData === void 0) {
    return pendingQuerySnapshot;
  }
  return successQuerySnapshot(initialData);
}
function initialPaginationSnapshot(args, initialData) {
  if (args === skipToken) {
    return getDisabledPaginationSnapshot();
  }
  if (initialData === void 0) {
    return pendingPaginationSnapshot();
  }
  return successPaginationSnapshot(initialData);
}
function successQuerySnapshot(data) {
  return { data, error: null, isLoading: false, status: "success" };
}
function pendingPaginationSnapshot() {
  return {
    canLoadMore: false,
    data: void 0,
    error: null,
    isLoading: true,
    isLoadingMore: false,
    loadMore: noop,
    status: "pending"
  };
}
function successPaginationSnapshot(data) {
  return {
    canLoadMore: false,
    data,
    error: null,
    isLoading: false,
    isLoadingMore: false,
    loadMore: noop,
    status: "success"
  };
}
function noop() {
}
const disabledQuerySnapshot = {
  data: void 0,
  error: null,
  isLoading: false,
  status: "disabled"
};
const pendingQuerySnapshot = {
  data: void 0,
  error: null,
  isLoading: true,
  status: "pending"
};
export {
  setupAuth,
  useAuth,
  usePaginatedQuery,
  useQuery
};
