import type { PostResponse, UserSummary } from '../lib/types'

export function makeUser(overrides: Partial<UserSummary> = {}): UserSummary {
  return { id: 10, username: 'bob', displayName: 'Bob Builder', avatarUrl: null, protectedAccount: false, ...overrides }
}

let nextId = 1000

export function makePost(overrides: Partial<PostResponse> = {}): PostResponse {
  const id = overrides.id ?? nextId++
  return {
    id,
    author: makeUser(),
    content: `post number ${id}`,
    mediaUrls: [],
    replyToId: null,
    likeCount: 0,
    replyCount: 0,
    likedByMe: false,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    repostCount: 0,
    repostedByMe: false,
    repostedBy: null,
    quotedPost: null,
    mentions: [],
    conversationId: id,
    replyPolicy: 'EVERYONE',
    canReply: true,
    bookmarkedByMe: false,
    ...overrides,
  }
}
