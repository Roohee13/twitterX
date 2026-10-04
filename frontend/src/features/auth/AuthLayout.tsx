import type { ReactNode } from 'react'
import { ThemeToggle } from '../../components/ui/ThemeToggle'
import { usePageTitle } from '../../lib/usePageTitle'

/** The centered card shared by login, register and the password / email screens. */
export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  usePageTitle(title)
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <ThemeToggle className="fixed right-3 top-3" />
      <div className="w-full max-w-md">
        <p aria-hidden="true" className="mb-6 text-center text-5xl font-black">X</p>
        <h1 className="mb-6 text-center text-3xl font-extrabold">{title}</h1>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-zinc-500">{footer}</div>}
      </div>
    </div>
  )
}

/** A form-level error (wrong password, server trouble) shown above the submit button. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  )
}
