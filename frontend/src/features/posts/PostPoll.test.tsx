import { useQuery } from '@tanstack/react-query'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { Poll, PostResponse } from '../../lib/types'
import { makePost } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { PostCard } from './PostCard'
import { pollStatus } from './PostPoll'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString()
const makePoll = (overrides: Partial<Poll> = {}): Poll => ({
  id: 7,
  options: [{ id: 71, text: 'Cats', voteCount: 3 }, { id: 72, text: 'Dogs', voteCount: 1 }],
  totalVotes: 4,
  expiresAt: inAnHour(),
  ended: false,
  myVoteOptionId: null,
  ...overrides,
})

/** Holds the post in the query cache like a real screen does, so a vote can update what is shown. */
function Harness({ initial }: { initial: PostResponse }) {
  const { data } = useQuery({ queryKey: ['post', initial.id], queryFn: () => initial, initialData: initial, staleTime: Infinity })
  return <PostCard post={data} />
}

async function show(poll: Poll) {
  const post = makePost({ id: 55, poll })
  renderSignedIn(<Harness initial={post} />)
  return screen.findByRole('group', { name: 'Poll' })
}

describe('poll on a post', () => {
  it('offers one button per option while the poll is open and you have not voted', async () => {
    const group = await show(makePoll())
    expect(within(group).getByRole('button', { name: 'Cats' })).toBeEnabled()
    expect(within(group).getByRole('button', { name: 'Dogs' })).toBeEnabled()
    expect(within(group).getByText('4 votes · 1 hour left')).toBeInTheDocument()
  })

  it('sends the vote, then shows percentages with your choice marked', async () => {
    let body: unknown
    server.use(http.post(`${BASE}/api/posts/55/poll/vote`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json(makePoll({
        options: [{ id: 71, text: 'Cats', voteCount: 3 }, { id: 72, text: 'Dogs', voteCount: 2 }],
        totalVotes: 5,
        myVoteOptionId: 72,
      }))
    }))
    const group = await show(makePoll())

    await userEvent.click(within(group).getByRole('button', { name: 'Dogs' }))

    expect(await within(group).findByRole('img', { name: 'Dogs: 40%, your vote' })).toBeInTheDocument()
    expect(within(group).getByRole('img', { name: 'Cats: 60%' })).toBeInTheDocument()
    expect(within(group).queryByRole('button')).not.toBeInTheDocument()
    expect(within(group).getByText('5 votes · 1 hour left')).toBeInTheDocument()
    expect(body).toEqual({ optionId: 72 })
  })

  it('shows results, not buttons, once you have voted or the poll has ended', async () => {
    const voted = await show(makePoll({ myVoteOptionId: 71 }))
    expect(within(voted).queryByRole('button')).not.toBeInTheDocument()
    expect(within(voted).getByRole('img', { name: 'Cats: 75%, your vote' })).toBeInTheDocument()
  })

  it('says "Final results" for an ended poll and shows 0% for every option when nobody voted', async () => {
    const group = await show(makePoll({ ended: true, totalVotes: 0, options: [{ id: 71, text: 'Cats', voteCount: 0 }, { id: 72, text: 'Dogs', voteCount: 0 }] }))
    expect(within(group).queryByRole('button')).not.toBeInTheDocument()
    expect(within(group).getByRole('img', { name: 'Cats: 0%' })).toBeInTheDocument()
    expect(within(group).getByText('0 votes · Final results')).toBeInTheDocument()
  })

  it('shows the server reason when the vote is refused, and keeps the buttons', async () => {
    server.use(http.post(`${BASE}/api/posts/55/poll/vote`, () => HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 })))
    const group = await show(makePoll())
    await userEvent.click(within(group).getByRole('button', { name: 'Cats' }))
    expect(await screen.findByText('This action is not allowed because of a block')).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Cats' })).toBeEnabled()
  })
})

describe('pollStatus', () => {
  const now = Date.parse('2026-06-01T12:00:00Z')
  const at = (minutes: number) => makePoll({ expiresAt: new Date(now + minutes * 60_000).toISOString() })

  it('counts down in minutes, hours and days', () => {
    expect(pollStatus(at(1), now)).toBe('1 minute left')
    expect(pollStatus(at(30), now)).toBe('30 minutes left')
    expect(pollStatus(at(120), now)).toBe('2 hours left')
    expect(pollStatus(at(60 * 24 * 3), now)).toBe('3 days left')
    expect(pollStatus(makePoll({ ended: true }), now)).toBe('Final results')
  })
})
