// Client-side hints that mirror the backend's rules (AuthDtos.java) so most mistakes are caught before a request is made.
// The server stays the authority: anything it rejects is still shown, under the matching field.

const USERNAME = /^[a-zA-Z0-9_]{3,15}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>

export function validateUsername(value: string): string | undefined {
  if (!value.trim()) return 'Enter a username'
  if (!USERNAME.test(value)) return 'Use 3-15 letters, digits or underscores'
}

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Enter your email address'
  if (value.length > 254 || !EMAIL.test(value.trim())) return 'Enter a valid email address'
}

export function validateDisplayName(value: string): string | undefined {
  if (!value.trim()) return 'Enter a name'
  if (value.trim().length > 50) return 'Use at most 50 characters'
}

export function validatePassword(value: string): string | undefined {
  if (value.length < 8) return 'Use at least 8 characters'
  if (value.length > 72) return 'Use at most 72 characters'
}

export interface RegistrationFields {
  username: string
  email: string
  displayName: string
  password: string
}

export function validateRegistration(fields: RegistrationFields): FieldErrors<keyof RegistrationFields> {
  const errors: FieldErrors<keyof RegistrationFields> = {
    username: validateUsername(fields.username),
    email: validateEmail(fields.email),
    displayName: validateDisplayName(fields.displayName),
    password: validatePassword(fields.password),
  }
  for (const key of Object.keys(errors) as Array<keyof RegistrationFields>) {
    if (!errors[key]) delete errors[key]
  }
  return errors
}
