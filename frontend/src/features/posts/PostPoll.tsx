import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { patchPost } from '../../lib/postCache'
import type { Poll, PostResponse } from '../../lib/types'

/** "2 hours left", "Final results". */
export function pollStatus(poll: Poll, now: number = Date.now()): string {
  if (poll.ended) return 'Final results'
  const minutes = Math.max(1, Math.ceil((new Date(poll.expiresAt).getTime() - now) / 60_000))
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} left`
  if (minutes < 60) return unit(minutes, 'minute')
  if (minutes < 60 * 24) return unit(Math.round(minutes / 60), 'hour')
  return unit(Math.round(minutes / (60 * 24)), 'day')
}

/** A poll under a post: buttons to vote while it is open and unvoted, bars with percentages once you have voted or it has ended. */
export function PostPoll({ post }: { post: PostResponse }) {
  const poll = post.poll
  const queryClient = useQueryClient()
  const toast = useToast()
  const [voting, setVoting] = useState<number | null>(null)
  if (!poll) return null

  const showResults = poll.ended || poll.myVoteOptionId !== null
  const percent = (votes: number) => (poll.totalVotes === 0 ? 0 : Math.round((votes / poll.totalVotes) * 100))
  const topVotes = Math.max(...poll.options.map((o) => o.voteCount))

  async function vote(optionId: number) {
    setVoting(optionId)
    try {
      const updated = await api.post<Poll>(`/api/posts/${post.id}/poll/vote`, { optionId })
      patchPost(queryClient, post.id, (p) => ({ ...p, poll: updated }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not record your vote.', 'error')
      // Already voted or ended elsewhere: show what the server has.
      if (e instanceof ApiError && e.status === 409) void queryClient.invalidateQueries()
    } finally {
      setVoting(null)
    }
  }

  return (
    <div role="group" aria-label="Poll" className="mt-3 space-y-2">
      {poll.options.map((option) =>
        showResults ? (
          <div
            key={option.id}
            role="img"
            aria-label={`${option.text}: ${percent(option.voteCount)}%${poll.myVoteOptionId === option.id ? ', your vote' : ''}`}
            className="relative overflow-hidden rounded-md border border-zinc-800 px-3 py-2"
          >
            <div
              aria-hidden="true"
              className={`absolute inset-y-0 left-0 ${option.voteCount === topVotes && topVotes > 0 ? 'bg-brand/40' : 'bg-zinc-700/60'}`}
              style={{ width: `${percent(option.voteCount)}%` }}
            />
            <div aria-hidden="true" className="relative flex justify-between gap-2 text-[15px]">
              <span className={poll.myVoteOptionId === option.id ? 'font-bold' : ''}>
                {option.text}{poll.myVoteOptionId === option.id ? ' ✓' : ''}
              </span>
              <span className="font-semibold">{percent(option.voteCount)}%</span>
            </div>
          </div>
        ) : (
          <button
            key={option.id}
            type="button"
            disabled={voting !== null}
            onClick={() => void vote(option.id)}
            className="w-full rounded-full border border-brand px-3 py-2 text-[15px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-60"
          >
            {option.text}
          </button>
        ),
      )}
      <p className="text-sm text-zinc-500">
        {poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'} · {pollStatus(poll)}
      </p>
    </div>
  )
}
