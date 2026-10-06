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
  /** A deactivated (or suspended or removed) account: the server sends the blank "XClone user", with no handle. Never link to it. */
  unavailable?: boolean
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
  /** Can open the admin pages (report review). Granted in the database, never through the app. */
  admin: boolean
}

export interface ProfileResponse {
  id: number
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  /** Null for an unavailable account. */
  createdAt: string | null
  followerCount: number
  followingCount: number
  followedByMe: boolean
  blockedByMe: boolean
  mutedByMe: boolean
  protectedAccount: boolean
  followRequestedByMe: boolean
  /** A deactivated account: only the name "XClone user" is real, everything else is empty. */
  unavailable?: boolean
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
  bookmarkedByMe: boolean
}

export type NotificationType = 'FOLLOW' | 'LIKE' | 'REPLY' | 'MENTION' | 'REPOST' | 'FOLLOW_REQUEST' | 'REPORT_RECEIVED' | 'POST_REMOVED' | 'REPORT_OUTCOME'

export interface NotificationResponse {
  id: number
  type: NotificationType
  /** Null for system notifications (moderation), which carry their text in `detail` instead. */
  actor: UserSummary | null
  postId: number | null
  postContent: string | null
  detail: string | null
  read: boolean
  createdAt: string
}

export interface LastMessage {
  id: number
  senderId: number
  content: string
  createdAt: string
  deleted: boolean
  /** It carries photos (its text may be empty). */
  hasMedia?: boolean
}

export interface ConversationResponse {
  id: number
  participant: UserSummary
  createdAt: string
  updatedAt: string
  /** Null while nobody has written yet. */
  lastMessage: LastMessage | null
  /** The other person's messages that you have not read. */
  unreadCount: number
}

export interface MessageResponse {
  id: number
  conversationId: number
  sender: UserSummary
  /** Empty once the sender deleted the message. */
  content: string
  createdAt: string
  /** When the sender last changed the text; null if never edited. */
  editedAt: string | null
  deleted: boolean
  /** The attached photos, in order; empty for none and once deleted. */
  mediaUrls?: string[]
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

// --- Admin: report review ---

export type ReportReason = 'SPAM' | 'HARASSMENT' | 'HATE_SPEECH' | 'VIOLENCE' | 'SEXUAL_CONTENT' | 'MISINFORMATION' | 'OTHER'
export type ReportStatus = 'OPEN' | 'DISMISSED' | 'RESOLVED'

interface AdminReportBase {
  id: number
  reporter: UserSummary
  reason: ReportReason
  status: ReportStatus
  createdAt: string
  handledBy: UserSummary | null
  handledAt: string | null
  /** What the admin told the people affected, if anything. */
  adminNote: string | null
  /** How many reports (any status) the same account or post has received. */
  totalReports: number
}

export type AccountStatus = 'ACTIVE' | 'DEACTIVATED' | 'DELETED' | 'SUSPENDED'

export interface AdminUserReport extends AdminReportBase {
  reportedUser: UserSummary
  reportedUserStatus: AccountStatus
}

export interface AdminPostView {
  id: number
  author: UserSummary
  content: string
  mediaUrls: string[]
  createdAt: string
  removed: boolean
}

export interface AdminPostReport extends AdminReportBase {
  post: AdminPostView
}

/** One line of the admin "check image storage" result; `hint` says what to change when `ok` is false. */
export interface StorageStep {
  id: string
  label: string
  ok: boolean
  detail: string
  hint: string | null
}

export interface StorageCheckResponse {
  ok: boolean
  steps: StorageStep[]
}
