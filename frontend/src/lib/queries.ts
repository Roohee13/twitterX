import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query'
import { api, pageUrl } from './api'
import type { CursorPage } from './types'

interface CursorQueryOptions {
  enabled?: boolean
  limit?: number
  /** Extra query-string parameters, e.g. `{ q: 'term' }`. */
  params?: Record<string, string>
}

/** One cursor-paginated endpoint as an infinite query: `nextCursor` of each page feeds the next request. */
export function useCursorQuery<T>(key: QueryKey, path: string, options: CursorQueryOptions = {}) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) =>
      api.get<CursorPage<T>>(pageUrl(path, pageParam, options.limit, options.params), { signal }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: options.enabled,
  })
}
