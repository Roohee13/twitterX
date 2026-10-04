import { createBrowserRouter } from 'react-router'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { GuestOnly, RequireAuth } from './features/auth/guards'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { VerifyEmailPage } from './features/auth/VerifyEmailPage'
import { AdminReportsPage } from './features/admin/AdminReportsPage'
import { BookmarksPage } from './features/bookmarks/BookmarksPage'
import { ExplorePage } from './features/explore/ExplorePage'
import { HashtagPage } from './features/explore/HashtagPage'
import { AppShell } from './features/shell/AppShell'
import { HomePage } from './features/home/HomePage'
import { PostPage } from './features/posts/PostPage'
import { FollowListPage } from './features/profile/FollowListPage'
import { FollowRequestsPage } from './features/profile/FollowRequestsPage'
import { ProfilePage } from './features/profile/ProfilePage'
import { ChatPage } from './features/messages/ChatPage'
import { MessagesPage } from './features/messages/MessagesPage'
import { NotificationsPage } from './features/notifications/NotificationsPage'
import { SettingsPage } from './features/settings/SettingsPage'
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
          { path: '/u/:username', element: <ProfilePage /> },
          { path: '/u/:username/followers', element: <FollowListPage kind="followers" /> },
          { path: '/u/:username/following', element: <FollowListPage kind="following" /> },
          { path: '/follow-requests', element: <FollowRequestsPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/messages', element: <MessagesPage /> },
          { path: '/messages/:id', element: <ChatPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/explore', element: <ExplorePage /> },
          { path: '/hashtag/:name', element: <HashtagPage /> },
          { path: '/bookmarks', element: <BookmarksPage /> },
          { path: '/admin/reports', element: <AdminReportsPage /> },
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
