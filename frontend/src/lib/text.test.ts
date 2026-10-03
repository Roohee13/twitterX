import { tokenize } from './text'

const plain = (tokens: ReturnType<typeof tokenize>) => tokens.map((t) => t.value).join('')

describe('tokenize', () => {
  it('finds hashtags (lowercased for the link) and keeps the original text', () => {
    const tokens = tokenize('Loving #Java and #spring_boot today')
    expect(tokens.filter((t) => t.type === 'hashtag')).toEqual([
      { type: 'hashtag', value: '#Java', name: 'java' },
      { type: 'hashtag', value: '#spring_boot', name: 'spring_boot' },
    ])
    expect(plain(tokens)).toBe('Loving #Java and #spring_boot today')
  })

  it('follows the backend hashtag rules', () => {
    const tags = (text: string) => tokenize(text).filter((t) => t.type === 'hashtag').map((t) => t.value)
    expect(tags('#123 is just a number')).toEqual([]) // needs at least one letter
    expect(tags('#2024goals')).toEqual(['#2024goals'])
    expect(tags('c#sharp and a#b')).toEqual([]) // not at a word boundary
    expect(tags('##double')).toEqual([])
    expect(tags('#日本語 #déjà_vu')).toEqual(['#日本語', '#déjà_vu'])
    expect(tags('(#inparens), #end.')).toEqual(['#inparens', '#end'])
  })

  it('links a mention only when the server resolved that account', () => {
    const tokens = tokenize('hi @Alice_01 and @ghost_user', ['alice_01'])
    expect(tokens.filter((t) => t.type === 'mention')).toEqual([{ type: 'mention', value: '@Alice_01', username: 'Alice_01' }])
    expect(plain(tokens)).toBe('hi @Alice_01 and @ghost_user')
  })

  it('does not treat emails or too-short handles as mentions', () => {
    expect(tokenize('mail bob@example.com or @ab', ['bob', 'ab']).some((t) => t.type === 'mention')).toBe(false)
  })

  it('links web addresses without the punctuation that ends the sentence', () => {
    const tokens = tokenize('see https://example.com/a?b=1&c=2. Then (http://x.org/p)!')
    expect(tokens.filter((t) => t.type === 'url').map((t) => t.value)).toEqual(['https://example.com/a?b=1&c=2', 'http://x.org/p'])
    expect(plain(tokens)).toBe('see https://example.com/a?b=1&c=2. Then (http://x.org/p)!')
  })

  it('does not link other schemes', () => {
    expect(tokenize('javascript:alert(1) and ftp://x.org').some((t) => t.type === 'url')).toBe(false)
  })

  it('keeps a #fragment inside a URL part of the URL', () => {
    const tokens = tokenize('read https://example.com/page#section now')
    expect(tokens.filter((t) => t.type === 'hashtag')).toEqual([])
    expect(tokens.find((t) => t.type === 'url')?.value).toBe('https://example.com/page#section')
  })

  it('never loses or reorders characters, including newlines and angle brackets', () => {
    const text = 'line one\n<b>bold</b> #tag\n\n@bob https://x.org, done'
    expect(plain(tokenize(text, ['bob']))).toBe(text)
  })
})
