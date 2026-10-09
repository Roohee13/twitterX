import type { PostResponse, ProfileResponse, UserSummary } from '../lib/types'

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
    poll: null,
    ...overrides,
  }
}

export function makeProfile(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    id: 10,
    username: 'bob',
    displayName: 'Bob Builder',
    bio: null,
    avatarUrl: null,
    bannerUrl: null,
    createdAt: '2026-03-04T10:30:00Z',
    followerCount: 5,
    followingCount: 7,
    followedByMe: false,
    blockedByMe: false,
    mutedByMe: false,
    protectedAccount: false,
    followRequestedByMe: false,
    canMessage: true,
    ...overrides,
  }
}
