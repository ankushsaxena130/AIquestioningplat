import type { AuthUser } from './types'

const TOKEN_KEY = 'discovery_auth_token'
const USER_KEY = 'discovery_auth_user'

export { type AuthUser }

export function getUser(): AuthUser | null {
  try {
    const storedUser = localStorage.getItem(USER_KEY)

    if (!storedUser) {
      return null
    }

    return JSON.parse(storedUser) as AuthUser
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function authHeaders(): Record<string, string> {
  const token = getToken()

  if (!token) {
    return {}
  }

  return {
    Authorization: `Bearer ${token}`,
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}