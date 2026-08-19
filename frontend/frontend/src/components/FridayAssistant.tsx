import React, { useEffect, useRef, useState } from 'react'
import { isSpeechSupported, listen, speak } from '../voice/speech'
import { matchSpokenOption, matchYesNo } from '../voice/matchOption'
import { QuestionDef } from '../types'

interface FridayAssistantProps {
  enabled: boolean
  onToggle: () => void
  /** The question Friday should currently read/listen for — either a real
   * question from the bank, or the synthetic "what's your role" question
   * App.tsx builds for the role-selection step. Pass undefined outside
   * both (e.g. the project-intake screen) so Friday stays quiet there. */
  currentQuestion: QuestionDef | undefined
  onAnswer: (answerText: string, wasOther: boolean) => void
  greeted: boolean
  onGreeted: () => void
}

type Phase = 'idle' | 'greeting' | 'announcing' | 'listening' | 'listening-freetext' | 'confirming'

// A little variety so Friday doesn't say the exact same opener before
// every single question — small touch, but it's what makes "enthusiastic"
// read as genuine rather than a single canned phrase on loop.
const OPENERS = ['Alright!', 'Okay!', 'Great, next up!', "Let's keep going!", 'Awesome, here we go!']
function randomOpener(): string {
  return OPENERS[Math.floor(Math.random() * OPENERS.length)]
}

export default function FridayAssistant({
  enabled,
  onToggle,
  currentQuestion,
  onAnswer,
  greeted,
  onGreeted
}: FridayAssistantProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [line, setLine] = useState('')
  const [heard, setHeard] = useState('')
  const runIdRef = useRef(0)
  const supported = isSpeechSupported()

  // Greets exactly once, as soon as Friday first becomes enabled (App.tsx
  // turns this on automatically right after project details are entered).
  useEffect(() => {
    if (!enabled || greeted || !supported) return
    let cancelled = false
    ;(async () => {
      setPhase('greeting')
      const greeting = 'Hello! I am Friday, I am your assistant today! I am so excited to help you out!'
      setLine(greeting)
      await speak(greeting)
      if (!cancelled) {
        onGreeted()
        setPhase('idle')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, greeted, supported])

  async function listenYesNo(): Promise<'yes' | 'no'> {
    for (let i = 0; i < 3; i++) {
      try {
        const t = await listen()
        setHeard(t)
        const yn = matchYesNo(t)
        if (yn) return yn
      } catch {
        // timed out / no speech — just re-prompt below
      }
      setLine('Just say yes or no, whenever you are ready!')
      await speak('Just say yes or no, whenever you are ready!')
    }
    return 'no' // safer default than accidentally confirming a wrong answer
  }

  // Reads the current question aloud, listens for a spoken option,
  // confirms it, and only then hands it off to onAnswer — which is the
  // same handler the on-screen buttons use (or App.tsx's role-select
  // handler, for the synthetic role question), so voice and click answers
  // go through identical downstream logic.
  useEffect(() => {
    if (!enabled || !supported || !greeted || !currentQuestion) return
    if (phase !== 'idle') return

    const myRunId = ++runIdRef.current
    let cancelled = false

    async function run() {
      const q = currentQuestion!
      setPhase('announcing')
      const intro = `${randomOpener()} ${q.domain}. ${q.question} Your options are: ${q.options.join(', ')}.`
      setLine(intro)
      await speak(intro)
      if (cancelled || runIdRef.current !== myRunId) return

      let confirmed = false
      let attempts = 0
      while (!confirmed && !cancelled && runIdRef.current === myRunId && attempts < 6) {
        attempts++
        setPhase('listening')
        setLine("I'm listening!")
        let heardText = ''
        try {
          heardText = await listen()
        } catch {
          setLine("Hmm, I didn't hear anything — go ahead and say one of the options!")
          await speak("Hmm, I didn't hear anything. Go ahead and say one of the options!")
          continue
        }
        if (cancelled || runIdRef.current !== myRunId) return
        setHeard(heardText)

        const matched = matchSpokenOption(heardText, q.options)
        if (!matched) {
          const retry = `Oops, I didn't quite catch that! Your choices are: ${q.options.join(', ')}.`
          setLine(retry)
          await speak(retry)
          continue
        }

        if (matched === 'Other') {
          setPhase('listening-freetext')
          setLine('Sure thing! Please tell me your answer.')
          await speak('Sure thing! Please tell me your answer.')
          let freeText = ''
          try {
            freeText = await listen(12000)
          } catch {
            setLine("I didn't catch that — let's give it another go!")
            await speak("I didn't catch that. Let's give it another go!")
            continue
          }
          if (cancelled || runIdRef.current !== myRunId) return
          if (!freeText.trim()) continue
          setHeard(freeText)
          setPhase('confirming')
          const confirmLine = `Got it — I heard: ${freeText}! Does that sound right? Say yes or no.`
          setLine(confirmLine)
          await speak(confirmLine)
          const yn = await listenYesNo()
          if (cancelled || runIdRef.current !== myRunId) return
          if (yn === 'yes') {
            onAnswer(freeText, true)
            confirmed = true
            setLine('Perfect, thank you!')
            await speak('Perfect, thank you!')
          } else {
            setLine("No worries, let's try that again!")
            await speak("No worries, let's try that again!")
          }
          continue
        }

        setPhase('confirming')
        const confirmLine = `Got it — I heard "${matched}"! Does that sound right? Say yes or no.`
        setLine(confirmLine)
        await speak(`Got it, I heard ${matched}! Does that sound right? Say yes or no.`)
        const yn = await listenYesNo()
        if (cancelled || runIdRef.current !== myRunId) return
        if (yn === 'yes') {
          onAnswer(matched, false)
          confirmed = true
          setLine('Awesome, thank you!')
          await speak('Awesome, thank you!')
        } else {
          setLine("No worries, let's try that again!")
          await speak("No worries, let's try that again!")
        }
      }
      if (runIdRef.current === myRunId) setPhase('idle')
    }

    run()
    return () => {
      cancelled = true
    }
    // Intentionally NOT depending on `phase` here — the async run()
    // function below calls setPhase(...) several times as it progresses
    // (announcing -> listening -> confirming -> ...). If `phase` were a
    // dependency, each of those setPhase calls would re-trigger this
    // effect, run the cleanup (cancelling the in-flight run), and abort
    // Friday right after the first line she spoke. This effect should
    // only restart when the question itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, supported, greeted, currentQuestion?.id])

  if (!supported) {
    return (
      <div className="mb-4 text-xs text-violet-200/60 bg-violet-950/20 border border-violet-400/20 rounded-xl px-3 py-2">
        🎙️ Friday (voice assistant) needs Chrome or Edge — not supported in this browser.
      </div>
    )
  }

  return (
    <div className="mb-4 bg-violet-950/30 border border-violet-400/30 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono uppercase tracking-wide text-violet-200/80">🎙️ Friday</span>
        <button
          onClick={onToggle}
          className={`text-xs px-3 py-1 rounded-full border transition-colors ${
            enabled
              ? 'border-violet-300 text-violet-50 bg-violet-500/20'
              : 'border-violet-400/30 text-violet-200/70 hover:border-violet-300'
          }`}
        >
          {enabled ? 'Mute Friday' : 'Unmute Friday'}
        </button>
      </div>
      {enabled && (
        <>
          <p className="text-sm text-violet-100 mt-1">
            {phase === 'listening' || phase === 'listening-freetext'
              ? '🎤 '
              : phase === 'confirming'
                ? '❓ '
                : phase === 'announcing' || phase === 'greeting'
                  ? '🗣️ '
                  : ''}
            {line}
          </p>
          {heard && phase === 'confirming' && <p className="text-xs text-violet-200/60 mt-1">You said: "{heard}"</p>}
        </>
      )}
    </div>
  )
}
