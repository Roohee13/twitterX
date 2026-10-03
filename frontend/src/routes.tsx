import { createBrowserRouter } from 'react-router'
import { GuestOnly, RequireAuth } from './features/auth/guards'
import { LoginPage, RegisterPage } from './features/auth/placeholders'
import { AppShell } from './features/shell/AppShell'
import { HomePage, NotFoundPage } from './features/shell/pages'

export const router = createBrowserRouter([
  {
    element: <RequireAuth />,
    children: [{ element: <AppShell />, children: [{ index: true, element: <HomePage /> }] }],
  },
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
