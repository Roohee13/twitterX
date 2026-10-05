import type { QueryClient } from '@tanstack/react-query'

/** The two Home feeds. Each is one infinite query; the key is also the prefix other code uses to find them in the cache. */
export const FOLLOWING_KEY = ['timeline']
export const FOR_YOU_KEY = ['for-you']
export const FEED_KEYS = [FOLLOWING_KEY, FOR_YOU_KEY]

/** Who or what appears in the feeds changed (a follow, a block, a mute, a profile edit): read both again. */
export function invalidateFeeds(queryClient: QueryClient) {
  for (const queryKey of FEED_KEYS) void queryClient.invalidateQueries({ queryKey })
}
