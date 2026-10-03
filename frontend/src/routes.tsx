import { createBrowserRouter } from 'react-router'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { GuestOnly, RequireAuth } from './features/auth/guards'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { VerifyEmailPage } from './features/auth/VerifyEmailPage'
import { AppShell } from './features/shell/AppShell'
import { HomePage } from './features/home/HomePage'
import { PostPage } from './features/posts/PostPage'
import { NotFoundPage } from './features/shell/pages'

export const router = createBrowserRouter([
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: '/post/:id', element: <PostPage /> },
        ],
      },
    ],
  },
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Link targets from emails: open to everyone, because the link may be opened signed in, signed out or on another device.
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '*', element: <NotFoundPage /> },
])
