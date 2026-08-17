import React from 'react'

export type ProgressMood = 'confident' | 'thinking'

interface DiscoveryProgressProps {
  percent: number          // 0-100, only moves forward on confident answers
  mood: ProgressMood       // 'confident' after a clear answer, 'thinking' after an unclear one
  message: string          // the line shown under the bar
  answered: number
  estimatedTotal: number
}

/**
 * Confidence -> face + copy, Akinator-style.
 * The bar itself only fills further when mood === 'confident'.
 * When mood === 'thinking', the fill stays exactly where it was —
 * the model is telling the user "I'm not sure I got that" rather than
 * silently guessing and moving on.
 */
function faceFor(mood: ProgressMood, percent: number): string {
  if (mood === 'thinking') return '🤔'
  if (percent >= 95) return '🤩'
  if (percent >= 75) return '😃'
  if (percent >= 40) return '🙂'
  return '🙂'
}

export default function DiscoveryProgress({
  percent,
  mood,
  message,
  answered,
  estimatedTotal
}: DiscoveryProgressProps) {
  const face = faceFor(mood, percent)
  const barColor = mood === 'thinking' ? 'bg-amber' : 'bg-signal'

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-wide text-ink/60">
          {answered} of ~{estimatedTotal} · {percent}%
        </span>
        <span
          className={`text-2xl leading-none transition-transform duration-300 ${
            mood === 'thinking' ? 'animate-pulse' : ''
          }`}
          aria-hidden="true"
        >
          {face}
        </span>
      </div>

      <div className="h-2.5 w-full rounded-full bg-line overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-700 ease-out`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <p
        className={`mt-2 text-sm font-medium ${
          mood === 'thinking' ? 'text-amber' : 'text-signal'
        }`}
      >
        {message}
      </p>
    </div>
  )
}
