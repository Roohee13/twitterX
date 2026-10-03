import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { patchPost, prependToTimeline } from '../../lib/postCache'
import type { PostResponse } from '../../lib/types'
import { Composer } from './Composer'

interface ComposeRequest {
  replyTo?: PostResponse
  quoting?: PostResponse
}

const ComposeContext = createContext<(request?: ComposeRequest) => void>(() => undefined)

/** Opens the composer in a dialog from anywhere: a new post, a reply, or a quote. */
export function useCompose() {
  return useContext(ComposeContext)
}

/** What to update after posts were created: the timeline for new top-level posts, the parent's reply count for a reply. */
export function usePostsCreated() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useCallback(
    (created: PostResponse[], request?: ComposeRequest) => {
      if (request?.replyTo) {
        const parentId = request.replyTo.id
        patchPost(queryClient, parentId, (p) => ({ ...p, replyCount: p.replyCount + 1 }))
        void queryClient.invalidateQueries({ queryKey: ['replies', parentId] })
        toast('Your reply was sent.')
      } else {
        prependToTimeline(queryClient, created)
        toast(created.length > 1 ? 'Your thread was posted.' : 'Your post was sent.')
      }
    },
    [queryClient, toast],
  )
}

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ComposeRequest | null>(null)
  const created = usePostsCreated()
  const open = useCallback((next: ComposeRequest = {}) => setRequest(next), [])
  const value = useMemo(() => open, [open])
  const title = request?.replyTo ? 'Reply' : request?.quoting ? 'Quote' : 'New post'

  return (
    <ComposeContext.Provider value={value}>
      {children}
      <Modal open={request !== null} onClose={() => setRequest(null)} title={title}>
        {request && (
          <Composer
            autoFocus
            replyTo={request.replyTo}
            quoting={request.quoting}
            submitLabel={request.replyTo ? 'Reply' : 'Post'}
            placeholder={request.replyTo ? 'Post your reply' : request.quoting ? 'Add a comment' : "What's happening?"}
            onPosted={(posts) => {
              created(posts, request)
              setRequest(null)
            }}
          />
        )}
      </Modal>
    </ComposeContext.Provider>
  )
}
