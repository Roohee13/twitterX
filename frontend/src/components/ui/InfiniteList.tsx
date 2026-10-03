import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import type { CursorPage } from '../../lib/types'
import { Spinner } from './Spinner'
import { EmptyState, ErrorState } from './States'

interface InfiniteListProps<T> {
  query: UseInfiniteQueryResult<InfiniteData<CursorPage<T>>, Error>
  renderItem: (item: T) => ReactNode
  getKey: (item: T) => string | number
  emptyTitle: string
  emptyText?: string
  /** Leaves some loaded items out of the list (e.g. ones already shown elsewhere on the page). */
  filter?: (item: T) => boolean
}

/** Renders every loaded page and fetches the next one when the bottom sentinel scrolls into view. */
export function InfiniteList<T>({ query, renderItem, getKey, emptyTitle, emptyText, filter }: InfiniteListProps<T>) {
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '300px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (query.isPending) return <Spinner />
  if (query.isError) return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />

  const items = query.data.pages.flatMap((page) => page.items).filter((item) => !filter || filter(item))
  if (items.length === 0) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>

  return (
    <div>
      {items.map((item) => (
        <div key={getKey(item)}>{renderItem(item)}</div>
      ))}
      <div ref={sentinel} />
      {isFetchingNextPage && <Spinner label="Loading more" />}
    </div>
  )
}
