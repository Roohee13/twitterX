import { createBrowserRouter } from 'react-router'
import { Spinner } from './components/ui/Spinner'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { GuestOnly, RequireAuth } from './features/auth/guards'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { VerifyEmailPage } from './features/auth/VerifyEmailPage'
import { BookmarksPage } from './features/bookmarks/BookmarksPage'
import { ExplorePage } from './features/explore/ExplorePage'
import { HashtagPage } from './features/explore/HashtagPage'
import { AppShell } from './features/shell/AppShell'
import { HomePage } from './features/home/HomePage'
import { PostPage } from './features/posts/PostPage'
import { FollowListPage } from './features/profile/FollowListPage'
import { FollowRequestsPage } from './features/profile/FollowRequestsPage'
import { ProfilePage } from './features/profile/ProfilePage'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { NotFoundPage } from './features/shell/pages'

// Pages most visitors open rarely (settings, admin) or that carry their own weight (messages) are loaded when first visited, so the
// first screen downloads less.
export const router = createBrowserRouter([
  {
    element: <RequireAuth />,
    hydrateFallbackElement: <Spinner label="Loading" />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <HomePage /> },
          { path: '/post/:id', element: <PostPage /> },
          { path: '/u/:username', element: <ProfilePage /> },
          { path: '/u/:username/followers', element: <FollowListPage kind="followers" /> },
          { path: '/u/:username/following', element: <FollowListPage kind="following" /> },
          { path: '/follow-requests', element: <FollowRequestsPage /> },
          { path: '/settings', lazy: () => import('./features/settings/SettingsPage').then((m) => ({ Component: m.SettingsPage })) },
          { path: '/messages', lazy: () => import('./features/messages/MessagesPage').then((m) => ({ Component: m.MessagesPage })) },
          { path: '/messages/:id', lazy: () => import('./features/messages/ChatPage').then((m) => ({ Component: m.ChatPage })) },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/explore', element: <ExplorePage /> },
          { path: '/hashtag/:name', element: <HashtagPage /> },
          { path: '/bookmarks', element: <BookmarksPage /> },
          { path: '/admin/reports', lazy: () => import('./features/admin/AdminReportsPage').then((m) => ({ Component: m.AdminReportsPage })) },
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
