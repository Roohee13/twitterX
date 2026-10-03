import { safeRedirect } from './redirect'
import { validateEmail, validatePassword, validateRegistration, validateUsername } from './validation'

describe('validation (mirrors the backend rules)', () => {
  it('checks usernames', () => {
    expect(validateUsername('alice_01')).toBeUndefined()
    expect(validateUsername('ab')).toMatch(/3-15/)
    expect(validateUsername('a'.repeat(16))).toMatch(/3-15/)
    expect(validateUsername('bad name')).toMatch(/3-15/)
    expect(validateUsername('  ')).toMatch(/Enter a username/)
  })

  it('checks emails and passwords', () => {
    expect(validateEmail('a@b.co')).toBeUndefined()
    expect(validateEmail('nope')).toMatch(/valid/)
    expect(validatePassword('1234567')).toMatch(/at least 8/)
    expect(validatePassword('12345678')).toBeUndefined()
    expect(validatePassword('x'.repeat(73))).toMatch(/at most 72/)
  })

  it('reports only the fields that are wrong', () => {
    const errors = validateRegistration({ username: 'alice', email: 'bad', displayName: ' ', password: 'longenough' })
    expect(Object.keys(errors).sort()).toEqual(['displayName', 'email'])
  })
})

describe('safeRedirect', () => {
  it('keeps paths inside the app', () => {
    expect(safeRedirect('/')).toBe('/')
    expect(safeRedirect('/u/alice?tab=likes')).toBe('/u/alice?tab=likes')
  })

  it('refuses anything that could leave the app or loop', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a://b', 42, null, undefined, '/login', '/register']) {
      expect(safeRedirect(bad)).toBe('/')
    }
  })
})
