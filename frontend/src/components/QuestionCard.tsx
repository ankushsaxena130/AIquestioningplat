import React, { useState } from 'react'
import { API_BASE } from '../App'

interface QuestionCardProps {
  domain: string
  question: string
  options: string[]
  onAnswer: (answerText: string, wasOther: boolean) => void
  busy?: boolean
  category?: 'gap' | 'ideation'
  pointsAvailable?: number
  onPointsEarned?: (points: number) => void
}

export default function QuestionCard({
  domain,
  question,
  options,
  onAnswer,
  busy,
  category = 'gap',
  pointsAvailable = 10,
  onPointsEarned,
}: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [showPointsPopup, setShowPointsPopup] = useState(false)
  const showOtherInput = selected === 'Other'

  const canContinue = selected && (selected !== 'Other' || otherText.trim().length > 0)

  // Calculate points based on answer quality
  function calculatePoints(answerText: string, wasOther: boolean): number {
    if (!wasOther) {
      // MCQ answers are worth full points
      return pointsAvailable
    }
    // Free text: award based on length (more thought = more points)
    const words = answerText.trim().split(/\s+/).length
    if (words >= 15) return pointsAvailable // Full points for detailed answer
    if (words >= 8) return Math.round(pointsAvailable * 0.75)
    if (words >= 3) return Math.round(pointsAvailable * 0.5)
    return Math.round(pointsAvailable * 0.25)
  }

  function getQualityFeedback(answerText: string, wasOther: boolean): string {
    if (!wasOther) return 'Great choice!'
    const words = answerText.trim().split(/\s+/).length
    if (words >= 15) return 'Excellent detail! 🌟'
    if (words >= 8) return 'Nice depth!'
    if (words >= 3) return 'Good start!'
    return 'Got it!'
  }

  function handleContinue() {
    if (!canContinue || !selected || busy) return

    const answerText = selected === 'Other' ? otherText.trim() : selected
    const wasOther = selected === 'Other'
    const points = calculatePoints(answerText, wasOther)

    // Show points animation
    setShowPointsPopup(true)
    setTimeout(() => setShowPointsPopup(false), 1000)

    if (onPointsEarned) {
      onPointsEarned(points)
    }

    onAnswer(answerText, wasOther)
    setSelected(null)
    setOtherText('')
    setExplanation(null)
  }

  async function handleExplain() {
    setExplaining(true)
    try {
      const res = await fetch(`${API_BASE}/explain-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, question }),
      })
      const data = await res.json()
      setExplanation(data.explanation)
    } catch {
      setExplanation(
        "Couldn't reach the explanation service — make sure the backend is running."
      )
    } finally {
      setExplaining(false)
    }
  }

  const points = selected && selected !== 'Other' ? pointsAvailable : calculatePoints(otherText, true)
  const qualityFeedback = getQualityFeedback(selected === 'Other' ? otherText : selected || '', selected === 'Other')

  return (
    <div
      className={`relative quest-card rounded-2xl p-7 animate-fade-in transition-opacity ${
        busy ? 'opacity-60 pointer-events-none' : ''
      }`}
    >
      {/* Points Popup */}
      {showPointsPopup && (
        <div className="score-popup animate-score-float" style={{ top: '-40px', left: '50%' }}>
          +{calculatePoints(
            selected === 'Other' ? otherText.trim() : selected || '',
            selected === 'Other'
          )} XP
        </div>
      )}

      {/* Quest Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex-1">
          <div className="quest-chapter mb-2">
            🎯 {domain.toUpperCase()}
          </div>
          <h2 className="font-display text-xl font-bold text-white mb-2">{question}</h2>
          {category === 'ideation' && (
            <p className="text-sm text-purple-100">
              💡 Bonus objective: Think about what would enhance this project
            </p>
          )}
        </div>

        {/* Points Badge */}
        <div className="text-center px-3 py-2 bg-gradient-to-br from-amber-500/20 to-orange-600/20 border border-amber-500/40 rounded-lg">
          <div className="text-lg font-display font-bold text-amber-300">+{pointsAvailable}</div>
          <div className="text-xs text-amber-200">XP</div>
        </div>
      </div>

      <button
        onClick={handleExplain}
        disabled={explaining}
        className="text-xs text-purple-300 hover:text-cyan-300 underline decoration-dotted underline-offset-2 mb-4 disabled:opacity-50 transition-colors"
      >
        {explaining ? 'Searching ancient texts…' : '❓ I need clarification'}
      </button>

      {explanation && (
        <div className="mb-5 text-sm text-purple-100 bg-gradient-to-r from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-lg px-4 py-3 leading-relaxed">
          <span className="text-cyan-300 font-semibold">💬 </span>
          {explanation}
        </div>
      )}

      {/* Options Grid */}
      <div className="grid gap-2 mb-5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => setSelected(opt)}
            className={`text-left px-5 py-3 rounded-lg border-2 transition-all font-medium ${
              selected === opt
                ? 'border-cyan-400 bg-gradient-to-r from-cyan-500/20 to-blue-600/20 text-white scale-105 shadow-lg shadow-cyan-500/30'
                : 'border-purple-500/30 hover:border-purple-400/60 text-white hover:text-cyan-100'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {/* Text Input Area */}
      {showOtherInput && (
        <div className="mb-5">
          <textarea
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Share your thoughts here..."
            className="w-full px-4 py-3 border-2 border-purple-500/30 bg-purple-900/20 text-white placeholder-purple-200 rounded-lg text-sm focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 resize-none transition-all"
            rows={3}
            autoFocus
          />
          {otherText.trim().length > 0 && (
            <div className="text-xs text-purple-300 mt-2 flex items-center gap-3">
              <span className="text-purple-400">📝 {otherText.trim().split(/\s+/).length} words</span>
              <span className="text-cyan-300 font-semibold">{qualityFeedback}</span>
            </div>
          )}
        </div>
      )}

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        disabled={!canContinue || busy}
        className={`w-full py-3 rounded-lg font-bold transition-all uppercase tracking-wide ${
          canContinue
            ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:shadow-lg hover:shadow-cyan-500/50 active:scale-95'
            : 'bg-purple-900/30 text-purple-400'
        } ${canContinue ? 'cursor-pointer' : 'cursor-not-allowed'}`}
      >
        {canContinue && `⚡ Continue (+${points} XP)`}
        {!canContinue && 'Select an answer to proceed'}
      </button>
    </div>
  )
}
