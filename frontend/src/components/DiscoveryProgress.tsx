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
  if (mood === 'thinking') return '🔮'
  if (percent >= 95) return '✨'
  if (percent >= 75) return '🌟'
  if (percent >= 40) return '⭐'
  return '🌙'
}

export default function DiscoveryProgress({
  percent,
  mood,
  message,
  answered,
  estimatedTotal
}: DiscoveryProgressProps) {
  const face = faceFor(mood, percent)
  const barColor = mood === 'thinking' ? 'from-amber-500 to-amber-400' : 'from-cyan-400 to-blue-500'

  return (
    <div className="w-full mb-6">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-xs uppercase tracking-widest text-purple-300">
          Quest Progress · {answered} of ~{estimatedTotal} · {percent}%
        </span>
        <span
          className={`text-3xl leading-none transition-transform duration-300 ${
            mood === 'thinking' ? 'animate-pulse' : 'animate-glow-pulse'
          }`}
          aria-hidden="true"
        >
          {face}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-3 w-full rounded-full bg-gradient-to-r from-purple-900/40 to-indigo-900/40 overflow-hidden border border-purple-500/30">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-700 ease-out shadow-lg ${
            mood === 'confident' ? 'shadow-cyan-500/50' : 'shadow-amber-500/50'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Message */}
      <p
        className={`mt-3 text-sm font-semibold ${
          mood === 'thinking' ? 'text-amber-300' : 'text-cyan-300'
        } transition-colors`}
      >
        {mood === 'thinking' ? '🔍 ' : '✓ '}{message}
      </p>
    </div>
  )
}
