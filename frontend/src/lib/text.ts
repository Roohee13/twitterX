// Splits post text into plain text, links, @mentions and #hashtags. The hashtag and mention patterns are the backend's
// (HashtagService.HASHTAG / MentionService.MENTION), so the app links exactly what the server recognised.
// The result is rendered as React text nodes and <a> elements only; post content is never inserted as HTML.

export type Token =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; href: string }
  | { type: 'mention'; value: string; username: string }
  | { type: 'hashtag'; value: string; name: string }

const PATTERN = new RegExp(
  String.raw`(?<url>https?:\/\/[^\s<>"']+)` +
    String.raw`|(?<![A-Za-z0-9_@./&])@(?<mention>[A-Za-z0-9_]{3,15})(?![A-Za-z0-9_])` +
    String.raw`|(?<![\p{L}\p{N}_#&/])#(?<tag>[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)`,
  'gu',
)

// Punctuation that ends a sentence rather than a link ("see https://x.com/a.").
const TRAILING = /[.,!?;:)\]}'"]+$/

/**
 * @param mentioned usernames the server resolved for this post (`post.mentions`). Only those become links, so
 * "@someone" that is not a real account stays plain text.
 */
export function tokenize(content: string, mentioned: Iterable<string> = []): Token[] {
  const known = new Set([...mentioned].map((name) => name.toLowerCase()))
  const tokens: Token[] = []
  let last = 0

  const pushText = (value: string) => {
    if (!value) return
    const previous = tokens[tokens.length - 1]
    if (previous?.type === 'text') previous.value += value
    else tokens.push({ type: 'text', value })
  }

  for (const match of content.matchAll(PATTERN)) {
    const start = match.index
    const raw = match[0]
    pushText(content.slice(last, start))
    last = start + raw.length

    if (match.groups?.url) {
      const trailing = TRAILING.exec(raw)?.[0] ?? ''
      const url = trailing ? raw.slice(0, raw.length - trailing.length) : raw
      tokens.push({ type: 'url', value: url, href: url })
      pushText(trailing)
    } else if (match.groups?.mention) {
      if (known.has(match.groups.mention.toLowerCase())) {
        tokens.push({ type: 'mention', value: raw, username: match.groups.mention })
      } else {
        pushText(raw)
      }
    } else if (match.groups?.tag) {
      tokens.push({ type: 'hashtag', value: raw, name: match.groups.tag.toLowerCase() })
    }
  }
  pushText(content.slice(last))
  return tokens
}
