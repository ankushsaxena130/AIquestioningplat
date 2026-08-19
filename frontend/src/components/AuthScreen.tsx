import React, { useState } from 'react'
import { API_BASE } from '../config'
import { AuthUser } from '../types'

interface AuthScreenProps {
  mode: 'client' | 'consultant'
  onSuccess: (token: string, user: AuthUser) => void
  onBack: () => void
}

export default function AuthScreen({ mode, onSuccess, onBack }: AuthScreenProps) {
  const isConsultant = mode === 'consultant'
  const [isRegister, setIsRegister] = useState(false) // only meaningful for the client path
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Please fill in both fields.')
      return
    }
    if (!isConsultant && isRegister && password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }

    setBusy(true)
    try {
      const endpoint = !isConsultant && isRegister ? '/auth/register' : '/auth/login'
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || 'Something went wrong. Please try again.')
        return
      }
      onSuccess(data.token, data.user)
    } catch {
      setError(`Couldn't reach the server at ${API_BASE}. Make sure the backend is running.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-sm animate-fade-in">
      <button onClick={onBack} className="text-sm text-violet-200/80 hover:text-violet-50 transition-colors mb-6">
        ← Back
      </button>

      <div className="quest-card rounded-2xl p-8">
        <h1 className="font-display text-xl font-bold text-violet-50 mb-1">
          {isConsultant ? 'Sage sign-in' : isRegister ? 'Create your account' : 'Welcome back'}
        </h1>
        <p className="text-sm text-violet-100/80 mb-6">
          {isConsultant
            ? 'Consultant access only.'
            : isRegister
              ? 'Set up an account to start (and revisit) your discovery sessions.'
              : 'Log in to continue your discovery quest.'}
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wide text-violet-200/70 mb-1.5">
              {isConsultant ? 'Consultant ID' : 'Email'}
            </label>
            <input
              type={isConsultant ? 'text' : 'email'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isConsultant ? 'spidey' : 'you@example.com'}
              className="w-full rounded-xl border border-violet-400/30 bg-violet-950/40 px-4 py-2.5 text-sm text-violet-50 placeholder-violet-300/40 focus:outline-none focus:border-violet-300"
              autoComplete={isConsultant ? 'username' : 'email'}
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wide text-violet-200/70 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-violet-400/30 bg-violet-950/40 px-4 py-2.5 text-sm text-violet-50 placeholder-violet-300/40 focus:outline-none focus:border-violet-300"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </div>
          {!isConsultant && isRegister && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wide text-violet-200/70 mb-1.5">
                Confirm password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-violet-400/30 bg-violet-950/40 px-4 py-2.5 text-sm text-violet-50 placeholder-violet-300/40 focus:outline-none focus:border-violet-300"
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-200 bg-red-500/10 border border-red-400/30 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white text-sm font-semibold py-2.5 shadow-lg shadow-purple-500/30 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Please wait…' : isConsultant ? 'Enter chamber' : isRegister ? 'Create account' : 'Log in'}
          </button>
        </form>

        {!isConsultant && (
          <p className="text-xs text-violet-200/70 mt-5 text-center">
            {isRegister ? 'Already have an account?' : "Don't have an account yet?"}{' '}
            <button
              onClick={() => {
                setIsRegister((v) => !v)
                setError(null)
              }}
              className="text-violet-100 font-medium hover:underline"
            >
              {isRegister ? 'Log in' : 'Register'}
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
