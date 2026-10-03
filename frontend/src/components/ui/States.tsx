import type { ReactNode } from 'react'
import { Button } from './Button'

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-xl font-bold">{title}</p>
      {children && <p className="mt-2 text-zinc-500">{children}</p>}
    </div>
  )
}

export function ErrorState({ message = 'Something went wrong.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="px-6 py-12 text-center">
      <p className="text-zinc-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
