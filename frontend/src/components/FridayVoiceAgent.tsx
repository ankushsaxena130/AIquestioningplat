import React, { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../App'

interface FridayVoiceAgentProps {
  domain: string
  question: string
  options: string[]           // should NOT include 'Other' — Friday only handles concrete MCQ choices
  onAnswer: (text: string, wasOther: boolean) => void
  greet: boolean
  onGreetComplete: () => void
  autoStart?: boolean         // try to begin without a tap; falls back to a tap button if the browser blocks it
}

type FridayState =
  | 'unsupported'
  | 'not-started'   // waiting for the one required tap (grants mic permission + unlocks audio)
  | 'speaking'
  | 'recording'
  | 'transcribing'
  | 'error'
  | 'idle'

const RECORD_MS = 4000 // fixed listening window — option names are short, no need for silence detection

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function matchOption(spoken: string, options: string[]): string | null {
  const norm = normalize(spoken)
  for (const opt of options) {
    if (normalize(opt) === norm) return opt
  }
  for (const opt of options) {
    const optNorm = normalize(opt)
    if (norm.includes(optNorm) || optNorm.includes(norm)) return opt
  }
  return null
}

export default function FridayVoiceAgent({ domain, question, options, onAnswer, greet, onGreetComplete, autoStart }: FridayVoiceAgentProps) {
  const [state, setState] = useState<FridayState>('not-started')
  const [heardText, setHeardText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const startedRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const hasMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    const hasRecorder = typeof MediaRecorder !== 'undefined'
    if (!hasMic || !hasRecorder) {
      setState('unsupported')
      return
    }
    // Try to begin automatically (e.g. right after login) — browsers will
    // silently block this without a recent user gesture, in which case we
    // just fall back to the visible "tap to start" button below instead
    // of hanging or throwing an unhandled error.
    if (autoStart && !startedRef.current) {
      handleStart(true).catch(() => setState('not-started'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After the first tap, Friday automatically re-reads whenever the
  // question changes — no further taps needed for the rest of the session.
  useEffect(() => {
    if (!startedRef.current) return
    if (state === 'unsupported') return
    readQuestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question])

  async function speak(text: string, onEnd: () => void) {
    setState('speaking')
    try {
      const res = await fetch(`${API_BASE}/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Friday could not speak just now')
      const data = await res.json()
      const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`)
      audioRef.current = audio
      audio.onended = onEnd
      audio.onerror = onEnd
      await audio.play()
    } catch (e: any) {
      setErrorMsg(e.message || 'Friday ran into a problem speaking.')
      setState('error')
    }
  }

  async function record(): Promise<Blob> {
    if (!streamRef.current) {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(streamRef.current, { mimeType })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)

    return new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      recorder.start()
      setTimeout(() => recorder.stop(), RECORD_MS)
    })
  }

  async function listenAndTranscribe(onResult: (text: string) => void, onFail: () => void) {
    setState('recording')
    try {
      const blob = await record()
      setState('transcribing')
      const formData = new FormData()
      formData.append('file', blob, 'clip.webm')
      const res = await fetch(`${API_BASE}/voice/listen`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error((await res.json()).detail || 'Friday could not hear that')
      const data = await res.json()
      if (!data.transcript || !data.transcript.trim()) {
        onFail()
        return
      }
      onResult(data.transcript)
    } catch (e: any) {
      setErrorMsg(e.message || "Friday couldn't process what you said.")
      setState('error')
    }
  }

  function readQuestion() {
    const optionsText = options.join(', ')
    speak(`${question} Your options are: ${optionsText}.`, () => {
      listenAndTranscribe(
        (heard) => {
          setHeardText(heard)
          const matched = matchOption(heard, options)
          if (matched) {
            confirmOption(matched)
          } else {
            speak("Sorry, I didn't catch a valid option. Let me repeat the question.", readQuestion)
          }
        },
        () => speak("I didn't hear anything. Let me repeat the question.", readQuestion)
      )
    })
  }

  function confirmOption(option: string) {
    speak(`I heard ${option}. Is that correct? Please say yes or no.`, () => {
      listenAndTranscribe(
        (heard) => {
          if (normalize(heard).includes('yes')) {
            onAnswer(option, false)
            setState('idle')
          } else {
            speak('Okay, let me read the question again.', readQuestion)
          }
        },
        () => speak("I didn't catch that. Let me read the question again.", readQuestion)
      )
    })
  }

  async function handleStart(isAutoAttempt = false) {
    startedRef.current = true
    try {
      // Requesting mic access here, inside the tap handler, is what
      // reliably satisfies the browser's user-gesture requirement for
      // both microphone permission and audio playback.
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      startedRef.current = false
      if (isAutoAttempt) {
        // Silent fallback — the browser blocked auto-start (no recent
        // gesture, or permission not yet granted). Not an error the user
        // needs to see; the tap button below covers it instead.
        throw e
      }
      setErrorMsg('Friday needs microphone permission to work — check your browser settings.')
      setState('error')
      return
    }
    if (greet) {
      speak('Hello, I am Friday, I am your assistant here.', () => {
        onGreetComplete()
        readQuestion()
      })
    } else {
      readQuestion()
    }
  }

  if (state === 'unsupported') {
    return (
      <div className="text-xs text-amber bg-amber/10 border border-amber/30 rounded-xl px-3 py-2 mb-4">
        Friday needs microphone access, which this browser doesn't support here — you can still answer normally below.
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="mb-4 text-xs text-amber bg-amber/10 border border-amber/30 rounded-xl px-3 py-2 flex items-center justify-between gap-2">
        <span>⚠ {errorMsg}</span>
        <button onClick={() => setState('not-started')} className="underline shrink-0">Retry</button>
      </div>
    )
  }

  if (state === 'not-started') {
    return (
      <button
        onClick={() => handleStart()}
        className="w-full mb-4 text-sm font-medium text-signal bg-signal/10 border border-signal/30 rounded-xl px-4 py-3 hover:bg-signal/15 transition-colors flex items-center justify-center gap-2"
      >
        🎙️ Tap to let Friday guide you through this
      </button>
    )
  }

  return (
    <div className="mb-4 text-xs bg-signal/5 border border-signal/20 rounded-xl px-3 py-2.5 flex items-center gap-2">
      <span className="text-lg animate-pulse">🎙️</span>
      <span className="text-ink/70">
        {state === 'speaking' && 'Friday is speaking…'}
        {state === 'recording' && 'Friday is listening — speak now…'}
        {state === 'transcribing' && 'Friday is processing what you said…'}
        {state === 'idle' && 'Got it — moving on.'}
      </span>
    </div>
  )
}