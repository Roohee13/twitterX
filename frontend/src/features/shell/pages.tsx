import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-extrabold">This page doesn't exist</h1>
      <Link to="/" className="font-semibold text-brand hover:underline">Go home</Link>
    </div>
  )
}
