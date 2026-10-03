import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, setSessionExpiredHandler } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { AuthResponse, UserResponse } from '../../lib/types'
import { useToast } from '../../components/ui/Toast'

export interface RegisterInput {
  username: string
  email: string
  password: string
  displayName: string
}

type Status = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

interface AuthContextValue {
  status: Status
  user: UserResponse | null
  login: (usernameOrEmail: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  /** Replaces the cached current user, e.g. after editing the profile. */
  setUser: (user: UserResponse) => void
  /** Re-reads the current user from the server (e.g. after the email was verified). */
  refreshUser: () => Promise<void>
  /** Re-run the session restore after the server was unreachable. */
  retry: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

/** The signed-in user. Only call inside routes that are behind RequireAuth. */
export function useCurrentUser(): UserResponse {
  const { user } = useAuth()
  if (!user) throw new Error('useCurrentUser needs a signed-in user')
  return user
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState<Status>(tokens.getRefresh() ? 'loading' : 'anonymous')
  const [user, setUserState] = useState<UserResponse | null>(null)
  const [attempt, setAttempt] = useState(0)

  const signedOut = useCallback(() => {
    setUserState(null)
    setStatus('anonymous')
    queryClient.clear()
  }, [queryClient])

  // The API client calls this when a refresh token is rejected: the session is over, wherever the user is.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      signedOut()
      toast('Your session expired. Please sign in again.', 'error')
    })
    return () => setSessionExpiredHandler(undefined)
  }, [signedOut, toast])

  // Restore the session after a reload: only the refresh token survives, the API client trades it for an access token.
  useEffect(() => {
    if (!tokens.getRefresh()) return
    let cancelled = false
    api
      .get<UserResponse>('/api/users/me')
      .then((me) => {
        if (cancelled) return
        setUserState(me)
        setStatus('authenticated')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // A network failure keeps the tokens so a retry can still restore the session.
        setStatus(e instanceof ApiError && e.status === 0 ? 'unreachable' : 'anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const accept = useCallback((response: AuthResponse) => {
    tokens.set(response.accessToken, response.refreshToken)
    setUserState(response.user)
    setStatus('authenticated')
  }, [])

  const login = useCallback(
    async (usernameOrEmail: string, password: string) => {
      accept(await api.post<AuthResponse>('/api/auth/login', { usernameOrEmail, password }, { auth: false }))
    },
    [accept],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      accept(await api.post<AuthResponse>('/api/auth/register', input, { auth: false }))
    },
    [accept],
  )

  const logout = useCallback(async () => {
    const refreshToken = tokens.getRefresh()
    try {
      if (refreshToken) await api.post('/api/auth/logout', { refreshToken }, { auth: false })
    } catch {
      /* the local session ends either way */
    }
    tokens.clear()
    signedOut()
  }, [signedOut])

  const refreshUser = useCallback(async () => {
    setUserState(await api.get<UserResponse>('/api/users/me'))
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login,
      register,
      logout,
      setUser: setUserState,
      refreshUser,
      retry: () => {
        setStatus('loading')
        setAttempt((n) => n + 1)
      },
    }),
    [status, user, login, register, logout, refreshUser],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
