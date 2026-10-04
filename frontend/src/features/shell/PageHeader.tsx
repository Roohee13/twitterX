import type { ReactNode } from 'react'
import { usePageTitle } from '../../lib/usePageTitle'

/** The sticky title bar at the top of every page in the main column. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  usePageTitle(title)
  return (
    <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-zinc-800 bg-black/80 px-4 py-3 backdrop-blur">
      <h1 className="text-xl font-bold">{title}</h1>
      {children}
    </div>
  )
}
