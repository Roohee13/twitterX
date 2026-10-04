import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { patchPost, removePost } from '../../lib/postCache'
import type { PostResponse, ReplyPolicy } from '../../lib/types'
import type { ReportReason } from '../common/ReportDialog'

const messageOf = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/**
 * Everything a user can do to a post. Toggles (like, repost, bookmark) update every cached copy of the post immediately
 * and undo themselves if the server refuses; a second click while one is in flight is ignored.
 */
export function usePostActions() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const inFlight = useRef(new Set<string>())

  const toggle = useCallback(
    async (post: PostResponse, name: string, apply: (p: PostResponse) => PostResponse, undo: (p: PostResponse) => PostResponse, request: () => Promise<unknown>, failure: string, acceptConflict = false) => {
      const key = `${name}:${post.id}`
      if (inFlight.current.has(key)) return
      inFlight.current.add(key)
      patchPost(queryClient, post.id, apply)
      try {
        await request()
      } catch (e) {
        // "Already bookmarked" means the post is in the state we wanted, so keep it.
        if (acceptConflict && e instanceof ApiError && e.status === 409) return
        patchPost(queryClient, post.id, undo)
        toast(messageOf(e, failure), 'error')
      } finally {
        inFlight.current.delete(key)
      }
    },
    [queryClient, toast],
  )

  return useMemo(
    () => ({
      toggleLike: (post: PostResponse) => {
        const liking = !post.likedByMe
        return toggle(
          post, 'like',
          (p) => ({ ...p, likedByMe: liking, likeCount: Math.max(0, p.likeCount + (liking ? 1 : -1)) }),
          (p) => ({ ...p, likedByMe: !liking, likeCount: Math.max(0, p.likeCount + (liking ? -1 : 1)) }),
          () => (liking ? api.post(`/api/posts/${post.id}/like`) : api.delete(`/api/posts/${post.id}/like`)),
          'Could not update your like.',
        )
      },
      toggleRepost: (post: PostResponse) => {
        const reposting = !post.repostedByMe
        return toggle(
          post, 'repost',
          (p) => ({ ...p, repostedByMe: reposting, repostCount: Math.max(0, p.repostCount + (reposting ? 1 : -1)) }),
          (p) => ({ ...p, repostedByMe: !reposting, repostCount: Math.max(0, p.repostCount + (reposting ? -1 : 1)) }),
          () => (reposting ? api.post(`/api/posts/${post.id}/repost`) : api.delete(`/api/posts/${post.id}/repost`)),
          'Could not update your repost.',
        )
      },
      toggleBookmark: (post: PostResponse) => {
        const adding = !post.bookmarkedByMe
        return toggle(
          post, 'bookmark',
          (p) => ({ ...p, bookmarkedByMe: adding }),
          (p) => ({ ...p, bookmarkedByMe: !adding }),
          async () => {
            try {
              await (adding ? api.post(`/api/posts/${post.id}/bookmark`) : api.delete(`/api/posts/${post.id}/bookmark`))
            } finally {
              void queryClient.invalidateQueries({ queryKey: ['bookmarks'] }) // the list on the Bookmarks page changed
            }
          },
          'Could not update your bookmark.',
          true,
        )
      },

      async deletePost(post: PostResponse): Promise<boolean> {
        try {
          await api.delete(`/api/posts/${post.id}`)
        } catch (e) {
          toast(messageOf(e, 'Could not delete the post.'), 'error')
          return false
        }
        removePost(queryClient, post.id)
        if (post.replyToId) patchPost(queryClient, post.replyToId, (p) => ({ ...p, replyCount: Math.max(0, p.replyCount - 1) }))
        toast('Your post was deleted.')
        return true
      },

      async editPost(post: PostResponse, content: string): Promise<PostResponse | null> {
        try {
          const updated = await api.patch<PostResponse>(`/api/posts/${post.id}`, { content })
          patchPost(queryClient, post.id, (p) => ({ ...p, content: updated.content, mentions: updated.mentions }))
          toast('Your post was updated.')
          return updated
        } catch (e) {
          toast(e instanceof ApiError ? (e.fieldErrors.content ?? e.message) : 'Could not save your changes.', 'error')
          return null
        }
      },

      async setReplyPolicy(post: PostResponse, replyPolicy: ReplyPolicy): Promise<boolean> {
        try {
          const updated = await api.patch<PostResponse>(`/api/posts/${post.id}/reply-policy`, { replyPolicy })
          patchPost(queryClient, post.id, (p) => ({ ...p, replyPolicy: updated.replyPolicy, canReply: updated.canReply }))
          toast('Who can reply was updated.')
          return true
        } catch (e) {
          toast(messageOf(e, 'Could not change who can reply.'), 'error')
          return false
        }
      },

      async report(post: PostResponse, reason: ReportReason): Promise<boolean> {
        try {
          await api.post(`/api/posts/${post.id}/report`, { reason })
          toast("Thanks for letting us know. We'll take a look.")
          return true
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            toast('You already reported this post.')
            return true
          }
          toast(messageOf(e, 'Could not send your report.'), 'error')
          return false
        }
      },

      async share(post: PostResponse) {
        const url = `${window.location.origin}/post/${post.id}`
        try {
          await navigator.clipboard.writeText(url)
          toast('Link copied to clipboard.')
        } catch {
          toast(`Copy this link: ${url}`)
        }
      },
    }),
    [queryClient, toast, toggle],
  )
}
