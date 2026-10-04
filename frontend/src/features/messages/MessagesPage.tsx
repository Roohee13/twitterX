import { SquarePen } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { useCursorQuery } from '../../lib/queries'
import type { ConversationResponse } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { ConversationRow } from './ConversationRow'
import { INBOX_KEY } from './messageCache'
import { NewMessageDialog } from './NewMessageDialog'

/** The inbox: conversations with messages, the most recently active first. */
export function MessagesPage() {
  const [composing, setComposing] = useState(false)
  const inbox = useCursorQuery<ConversationResponse>(INBOX_KEY, '/api/conversations', { staleTime: 5_000 })
  return (
    <>
      <PageHeader title="Messages">
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setComposing(true)}>
          <SquarePen size={16} aria-hidden="true" /> New message
        </Button>
      </PageHeader>
      <InfiniteList
        query={inbox}
        getKey={(c) => c.id}
        renderItem={(c) => <ConversationRow conversation={c} />}
        emptyTitle="No messages yet"
        emptyText="Start a conversation with New message, or from someone's profile."
      />
      {composing && <NewMessageDialog onClose={() => setComposing(false)} />}
    </>
  )
}
