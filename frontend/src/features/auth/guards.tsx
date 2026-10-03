import { Navigate, Outlet, useLocation } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { useAuth } from './AuthContext'

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center">{children}</div>
}

/** Signed-in routes. Shows a spinner while the session is restored and sends visitors to /login otherwise. */
export function RequireAuth() {
  const { status, retry } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreen><Spinner label="Restoring your session" /></FullScreen>
  if (status === 'unreachable') {
    return (
      <FullScreen>
        <div role="alert" className="text-center">
          <p className="mb-4 text-zinc-300">Cannot reach the server.</p>
          <Button onClick={retry}>Try again</Button>
        </div>
      </FullScreen>
    )
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

/** Login and register: a signed-in visitor goes home instead. */
export function GuestOnly() {
  const { status } = useAuth()
  if (status === 'loading') return <FullScreen><Spinner label="Restoring your session" /></FullScreen>
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
