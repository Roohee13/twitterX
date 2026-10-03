import { Link } from 'react-router'
import { tokenize } from '../../lib/text'
import type { UserSummary } from '../../lib/types'

/** "https://example.com/a/very/long/path" -> "example.com/a/very/long/pa…" */
function shortUrl(url: string) {
  const bare = url.replace(/^https?:\/\//, '')
  return bare.length > 30 ? `${bare.slice(0, 29)}…` : bare
}

const linkClass = 'text-brand hover:underline'

/** Post text with #hashtags, @mentions and web addresses turned into links. Everything is rendered as text, never as HTML. */
export function PostText({ content, mentions, className = '' }: { content: string; mentions: UserSummary[]; className?: string }) {
  if (!content) return null
  const tokens = tokenize(content, mentions.map((m) => m.username))
  return (
    <p className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${className}`}>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'hashtag':
            return <Link key={i} to={`/hashtag/${encodeURIComponent(token.name)}`} className={linkClass}>{token.value}</Link>
          case 'mention':
            return <Link key={i} to={`/u/${token.username}`} className={linkClass}>{token.value}</Link>
          case 'url':
            return (
              <a key={i} href={token.href} target="_blank" rel="noopener noreferrer nofollow" title={token.href} className={linkClass}>
                {shortUrl(token.value)}
              </a>
            )
          default:
            return token.value
        }
      })}
    </p>
  )
}
