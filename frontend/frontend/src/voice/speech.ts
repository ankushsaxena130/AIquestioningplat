// Speech I/O for Friday. Two sources for the "speaking" half:
//   1. Sarvam AI (Bulbul v3), via our backend at /voice/tts — sounds
//      genuinely natural/expressive. Requires SARVAM_API_KEY on the
//      backend; if that's not set, or the request fails for any reason,
//      this silently falls back to option 2 below.
//   2. The browser's built-in speechSynthesis — always available (in
//      Chrome/Edge), works with zero configuration, but sounds more
//      robotic. Friday still fully works on this alone.
// Listening (speech-to-text) always uses the browser's native
// SpeechRecognition — there's no backend involved for that half.

import { API_BASE } from '../config'

export function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as any
  const hasTTS = 'speechSynthesis' in window
  const hasSTT = 'SpeechRecognition' in w || 'webkitSpeechRecognition' in w
  return hasTTS && hasSTT
}

// --- Sarvam AI (preferred) ---------------------------------------------

async function sarvamSpeak(text: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pace: 1.08 })
    })
    if (!res.ok) return false // e.g. 503 — SARVAM_API_KEY not configured on the backend
    const data = await res.json()
    if (!data.audioBase64) return false

    const audio = new Audio(`data:audio/${data.format || 'wav'};base64,${data.audioBase64}`)
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve()
      audio.onerror = () => resolve()
      audio.play().catch(() => resolve())
    })
    return true
  } catch {
    return false // network error, backend not running, etc. — fall back silently
  }
}

// --- Browser speechSynthesis (fallback) ---------------------------------

// Voice lists load asynchronously in most browsers (empty on the very
// first call), so this waits for the 'voiceschanged' event once, then
// caches the result — we only need to pick a voice once per page load.
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesPromise) return voicesPromise
  voicesPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices()
    if (existing.length > 0) {
      resolve(existing)
      return
    }
    const handler = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handler)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', handler)
    // Fallback in case the browser never fires voiceschanged.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500)
  })
  return voicesPromise
}

const PREFERRED_VOICE_NAMES = [
  'Microsoft Aria Online (Natural) - English (United States)',
  'Microsoft Jenny Online (Natural) - English (United States)',
  'Google US English',
  'Samantha',
  'Microsoft Zira - English (United States)'
]

async function pickFridayVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices()
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = voices.find((v) => v.name === name)
    if (match) return match
  }
  const femaleEnglish = voices.find((v) => v.lang.startsWith('en') && /female|zira|aria|jenny|samantha|susan|victoria/i.test(v.name))
  if (femaleEnglish) return femaleEnglish
  const anyEnglish = voices.find((v) => v.lang.startsWith('en'))
  return anyEnglish || voices[0] || null
}

async function browserSpeak(text: string): Promise<void> {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.05
  utterance.pitch = 1.15
  utterance.volume = 1
  const voice = await pickFridayVoice()
  if (voice) utterance.voice = voice
  return new Promise((resolve) => {
    utterance.onend = () => resolve()
    utterance.onerror = () => resolve()
    window.speechSynthesis.speak(utterance)
  })
}

/**
 * Speaks the given text aloud. Tries Sarvam AI first for a natural voice;
 * falls back to the browser's built-in speech synthesis automatically if
 * Sarvam isn't configured or the call fails for any reason. Resolves once
 * speech finishes either way.
 */
export async function speak(text: string): Promise<void> {
  const spokeViaSarvam = await sarvamSpeak(text)
  if (spokeViaSarvam) return
  await browserSpeak(text)
}

function getRecognitionCtor(): (new () => any) | null {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

/**
 * Listens for a single utterance and resolves with the transcript.
 * Rejects if nothing usable was heard within timeoutMs, on a recognition
 * error, or if the browser doesn't support speech recognition at all.
 */
export function listen(timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      reject(new Error('Speech recognition not supported in this browser'))
      return
    }
    const recognition = new Ctor()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        recognition.stop()
      } catch {
        // already stopped — ignore
      }
      reject(new Error('Listening timed out'))
    }, timeoutMs)

    recognition.onresult = (event: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const transcript = event.results?.[0]?.[0]?.transcript ?? ''
      resolve(transcript)
    }
    recognition.onerror = (event: any) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(event.error || 'Speech recognition error'))
    }
    recognition.onend = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error('No speech detected'))
    }

    try {
      recognition.start()
    } catch (e) {
      settled = true
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error('Could not start listening'))
    }
  })
}
