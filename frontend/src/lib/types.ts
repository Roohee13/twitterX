// Hand-written mirrors of the backend DTOs (src/main/java/.../*Dtos.java). Dates are ISO-8601 strings.

export type ReplyPolicy = 'EVERYONE' | 'FOLLOWING' | 'MENTIONED'

export interface CursorPage<T> {
  items: T[]
  /** Pass back as `cursor` for the next page; null when there are no more. */
  nextCursor: number | null
}

export interface UserSummary {
  id: number
  username: string
  displayName: string
  avatarUrl: string | null
  protectedAccount: boolean
}

/** The signed-in user (also returned on login and register). */
export interface UserResponse {
  id: number
  username: string
  email: string
  emailVerified: boolean
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  createdAt: string
  protectedAccount: boolean
}

export interface ProfileResponse {
  id: number
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  createdAt: string
  followerCount: number
  followingCount: number
  followedByMe: boolean
  blockedByMe: boolean
  mutedByMe: boolean
  protectedAccount: boolean
  followRequestedByMe: boolean
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: UserResponse
}

export interface PostResponse {
  id: number
  author: UserSummary
  content: string
  mediaUrls: string[]
  replyToId: number | null
  likeCount: number
  replyCount: number
  likedByMe: boolean
  createdAt: string
  repostCount: number
  repostedByMe: boolean
  /** Set when this row is someone's repost; every other field then describes the original post. */
  repostedBy: UserSummary | null
  quotedPost: PostResponse | null
  mentions: UserSummary[]
  conversationId: number
  replyPolicy: ReplyPolicy
  canReply: boolean
}

export type NotificationType = 'FOLLOW' | 'LIKE' | 'REPLY' | 'MENTION' | 'REPOST' | 'FOLLOW_REQUEST'

export interface NotificationResponse {
  id: number
  type: NotificationType
  actor: UserSummary
  postId: number | null
  postContent: string | null
  read: boolean
  createdAt: string
}

export interface ConversationResponse {
  id: number
  participant: UserSummary
  createdAt: string
  updatedAt: string
}

export interface MessageResponse {
  id: number
  conversationId: number
  sender: UserSummary
  content: string
  createdAt: string
}

export interface UploadUrlResponse {
  key: string
  uploadUrl: string
  headers: Record<string, string[]>
  publicUrl: string
  expiresAt: string
}

export interface TrendingHashtag {
  name: string
  postCount: number
  userCount: number
}

export interface SuggestionResponse {
  user: UserSummary
  mutualFollowCount: number
}

/** RFC 9457 problem JSON as returned by the API. `errors` holds field messages for 400 validation failures. */
export interface Problem {
  title?: string
  status?: number
  detail?: string
  errors?: Record<string, string>
}
