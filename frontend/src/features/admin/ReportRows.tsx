import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { fullDate, timeAgo } from '../../lib/time'
import type { AdminPostReport, AdminUserReport, ReportStatus, UserSummary } from '../../lib/types'
import { PostHeader } from '../posts/PostHeader'
import { PostMedia } from '../posts/PostMedia'
import { PostText } from '../posts/PostText'
import { NoteDialog } from './NoteDialog'
import { accountStatusLabel, reasonLabel, statusLabel } from './reportText'
import { useReportActions } from './useReportActions'

const badge: Record<ReportStatus, string> = {
  OPEN: 'bg-amber-500/15 text-amber-300',
  DISMISSED: 'bg-zinc-700 text-zinc-300',
  RESOLVED: 'bg-green-500/15 text-green-300',
}

function WhoAndWhen({ report }: { report: AdminUserReport | AdminPostReport }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">{reasonLabel[report.reason]}</span>
      <span className={`rounded px-2 py-0.5 font-semibold ${badge[report.status]}`}>{statusLabel[report.status]}</span>
      <span className="text-zinc-500">
        reported by <Link to={`/u/${report.reporter.username}`} className="hover:underline">@{report.reporter.username}</Link> ·{' '}
        <time dateTime={report.createdAt} title={fullDate(report.createdAt)}>{timeAgo(report.createdAt)}</time>
      </span>
    </div>
  )
}

function Handled({ report }: { report: AdminUserReport | AdminPostReport }) {
  if (report.status === 'OPEN' || !report.handledBy || !report.handledAt) return null
  return (
    <p className="text-sm text-zinc-500">
      {statusLabel[report.status]} by @{report.handledBy.username} · <time dateTime={report.handledAt} title={fullDate(report.handledAt)}>{timeAgo(report.handledAt)}</time>
    </p>
  )
}

function Total({ count, what }: { count: number; what: string }) {
  return <p className={`text-sm ${count > 1 ? 'font-semibold text-amber-300' : 'text-zinc-500'}`}>{count} {count === 1 ? 'report' : 'reports'} against this {what}</p>
}

function StatusButtons({ kind, report, extra }: { kind: 'users' | 'posts'; report: AdminUserReport | AdminPostReport; extra?: React.ReactNode }) {
  const actions = useReportActions()
  const [busy, setBusy] = useState<ReportStatus | null>(null)
  const set = async (status: ReportStatus) => {
    setBusy(status)
    await actions.setStatus(kind, report.id, status)
    setBusy(null)
  }
  return (
    <div className="flex flex-wrap gap-2">
      {report.status === 'OPEN' ? (
        <>
          <Button size="sm" variant="secondary" loading={busy === 'DISMISSED'} disabled={busy !== null} onClick={() => void set('DISMISSED')}>Dismiss</Button>
          <Button size="sm" loading={busy === 'RESOLVED'} disabled={busy !== null} onClick={() => void set('RESOLVED')}>Resolve</Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" loading={busy === 'OPEN'} disabled={busy !== null} onClick={() => void set('OPEN')}>Reopen</Button>
      )}
      {extra}
    </div>
  )
}

function AccountCard({ user }: { user: UserSummary }) {
  return (
    <Link to={`/u/${user.username}`} className="flex items-center gap-3 rounded-xl border border-zinc-800 p-3 hover:bg-hover">
      <Avatar src={user.avatarUrl} name={user.displayName} />
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-bold">
          <span className="truncate">{user.displayName}</span>
          {user.protectedAccount && <Lock size={14} aria-label="Protected account" className="shrink-0 text-zinc-400" />}
        </span>
        <span className="block truncate text-zinc-500">@{user.username}</span>
      </span>
    </Link>
  )
}

export function UserReportRow({ report }: { report: AdminUserReport }) {
  const actions = useReportActions()
  const [dialog, setDialog] = useState<'suspend' | 'remove' | null>(null)
  const { reportedUser: user, reportedUserStatus: accountStatus } = report
  const suspended = accountStatus === 'SUSPENDED'
  return (
    <article aria-label={`Report on @${report.reportedUser.username}`} className="space-y-3 border-b border-zinc-800 px-4 py-4">
      <WhoAndWhen report={report} />
      <AccountCard user={user} />
      {(suspended || accountStatus === 'DELETED') && (
        <p className="text-sm font-semibold text-red-300">{accountStatusLabel[accountStatus]}</p>
      )}
      <Total count={report.totalReports} what="account" />
      <Handled report={report} />
      <StatusButtons
        kind="users"
        report={report}
        extra={accountStatus !== 'DELETED' && (
          <>
            {suspended ? (
              <Button size="sm" variant="secondary" onClick={() => void actions.accountAction('unsuspend', user.id)}>Unsuspend account</Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setDialog('suspend')}>Suspend account</Button>
            )}
            <Button size="sm" variant="danger" onClick={() => setDialog('remove')}>Remove account</Button>
          </>
        )}
      />
      {dialog === 'suspend' && (
        <NoteDialog title={`Suspend @${user.username}?`} confirmLabel="Suspend account" onConfirm={(note) => actions.accountAction('suspend', user.id, note)} onClose={() => setDialog(null)}>
          They are signed out everywhere, cannot sign in, and their profile and posts are hidden until you unsuspend them. Open reports about the account are marked resolved, and they get an email.
        </NoteDialog>
      )}
      {dialog === 'remove' && (
        <NoteDialog
          title={`Remove @${user.username}?`}
          confirmLabel="Remove account"
          typeToConfirm={user.username}
          onConfirm={(note) => actions.accountAction('remove', user.id, note)}
          onClose={() => setDialog(null)}
        >
          This permanently erases the account&apos;s profile, posts, likes and follows. It cannot be undone. They get an email first.
        </NoteDialog>
      )}
    </article>
  )
}

export function PostReportRow({ report }: { report: AdminPostReport }) {
  const actions = useReportActions()
  const [confirming, setConfirming] = useState(false)
  const { post } = report
  return (
    <article aria-label={`Report on a post by @${post.author.username}`} className="space-y-3 border-b border-zinc-800 px-4 py-4">
      <WhoAndWhen report={report} />
      <div className="rounded-xl border border-zinc-800 p-3">
        <PostHeader author={post.author} createdAt={post.createdAt} />
        <PostText content={post.content} mentions={[]} className="text-[15px]" />
        <PostMedia urls={post.mediaUrls} />
        {post.removed && <p className="mt-2 text-sm font-semibold text-red-300">This post has been removed.</p>}
      </div>
      <Total count={report.totalReports} what="post" />
      <Handled report={report} />
      <StatusButtons
        kind="posts"
        report={report}
        extra={!post.removed && <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>Remove post</Button>}
      />
      {confirming && (
        <NoteDialog title="Remove this post?" confirmLabel="Remove post" onConfirm={(note) => actions.removePost(post.id, note)} onClose={() => setConfirming(false)}>
          The post disappears for everyone and every open report about it is marked resolved. The author is told, and so are the reporters. This cannot be undone from here.
        </NoteDialog>
      )}
    </article>
  )
}
