import { Link } from 'react-router'
import { EmptyState } from '../../components/ui/States'
import { PageHeader } from './PageHeader'

export function HomePage() {
  return (
    <>
      <PageHeader title="Home" />
      <EmptyState title="Your timeline is on its way">The home timeline is built in the next step.</EmptyState>
    </>
  )
}

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-extrabold">This page doesn't exist</h1>
      <Link to="/" className="font-semibold text-brand hover:underline">Go home</Link>
    </div>
  )
}
