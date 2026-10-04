import { ShieldAlert } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { EmptyState } from '../../components/ui/States'
import { useCursorQuery } from '../../lib/queries'
import type { AdminPostReport, AdminUserReport } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { PageHeader } from '../shell/PageHeader'
import { PostReportRow, UserReportRow } from './ReportRows'
import { ADMIN_REPORTS_KEY } from './useReportActions'

const KINDS = [
  { id: 'accounts', label: 'Accounts', api: 'users' },
  { id: 'posts', label: 'Posts', api: 'posts' },
] as const
const FILTERS = [
  { id: 'OPEN', label: 'Open' },
  { id: 'HANDLED', label: 'Handled' },
  { id: 'ALL', label: 'All' },
] as const

type Filter = (typeof FILTERS)[number]['id']

function Tabs<T extends string>({ label, items, current, onChange }: { label: string; items: ReadonlyArray<{ id: T; label: string }>; current: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex border-b border-zinc-800">
      {items.map((item) => (
        <button key={item.id} role="tab" type="button" aria-selected={current === item.id} onClick={() => onChange(item.id)}
          className={`flex-1 py-3 font-semibold hover:bg-zinc-900 ${current === item.id ? 'border-b-4 border-brand text-zinc-100' : 'text-zinc-500'}`}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

function UserReports({ status }: { status: Filter }) {
  const reports = useCursorQuery<AdminUserReport>([...ADMIN_REPORTS_KEY, 'users', status], '/api/admin/reports/users', { params: { status }, staleTime: 5_000 })
  return <InfiniteList query={reports} getKey={(r) => r.id} renderItem={(r) => <UserReportRow report={r} />} emptyTitle={status === 'OPEN' ? 'No open account reports' : 'No account reports here'} emptyText="Nothing needs your attention." />
}

function PostReports({ status }: { status: Filter }) {
  const reports = useCursorQuery<AdminPostReport>([...ADMIN_REPORTS_KEY, 'posts', status], '/api/admin/reports/posts', { params: { status }, staleTime: 5_000 })
  return <InfiniteList query={reports} getKey={(r) => r.id} renderItem={(r) => <PostReportRow report={r} />} emptyTitle={status === 'OPEN' ? 'No open post reports' : 'No post reports here'} emptyText="Nothing needs your attention." />
}

/** The reports users have sent about accounts and posts, for admins to dismiss, resolve, or (for posts) act on. */
export function AdminReportsPage() {
  const user = useCurrentUser()
  const [params, setParams] = useSearchParams()
  const kind = KINDS.find((k) => k.id === params.get('tab')) ?? KINDS[0]
  const status = FILTERS.find((f) => f.id === params.get('status'))?.id ?? 'OPEN'
  const update = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params)
    if (value === fallback) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  // The server enforces this too (403); checking here just avoids a pointless request and shows a clear message.
  if (!user.admin) {
    return (
      <>
        <PageHeader title="Reports" />
        <div role="alert"><EmptyState title="This page is for admins">Your account does not have access to the report review.</EmptyState></div>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Reports"><ShieldAlert size={18} aria-hidden="true" className="text-zinc-400" /></PageHeader>
      <Tabs label="Kind of report" items={KINDS} current={kind.id} onChange={(id) => update('tab', id, 'accounts')} />
      <Tabs label="Status" items={FILTERS} current={status} onChange={(id) => update('status', id, 'OPEN')} />
      {kind.id === 'accounts' ? <UserReports status={status} /> : <PostReports status={status} />}
    </>
  )
}
