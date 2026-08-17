import React, { useState } from 'react'
import { API_BASE } from '../App'

interface QuestionCardProps {
  domain: string
  question: string
  options: string[]
  onAnswer: (answerText: string, wasOther: boolean) => void
  busy?: boolean
}

export default function QuestionCard({ domain, question, options, onAnswer, busy }: QuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [otherText, setOtherText] = useState('')
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const showOtherInput = selected === 'Other'

  const canContinue = selected && (selected !== 'Other' || otherText.trim().length > 0)

  function handleContinue() {
    if (!canContinue || !selected || busy) return
    if (selected === 'Other') {
      onAnswer(otherText.trim(), true)
    } else {
      onAnswer(selected, false)
    }
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
        body: JSON.stringify({ domain, question })
      })
      const data = await res.json()
      setExplanation(data.explanation)
    } catch {
      setExplanation("Couldn't reach the explanation service — make sure the backend is running.")
    } finally {
      setExplaining(false)
    }
  }

  return (
    <div className={`bg-white border border-line rounded-2xl p-6 shadow-sm animate-fade-in transition-opacity ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-signal bg-signal/10 px-2 py-1 rounded-full">
        {domain}
      </span>

      <h2 className="font-display text-lg font-semibold mt-4 mb-1 text-ink">
        {question}
      </h2>

      <button
        onClick={handleExplain}
        disabled={explaining}
        className="text-xs text-ink/40 hover:text-signal underline decoration-dotted underline-offset-2 mb-4 disabled:opacity-50"
      >
        {explaining ? 'Thinking…' : "I don't understand this — explain it differently"}
      </button>

      {explanation && (
        <div className="mb-4 text-sm text-ink/70 bg-paper border border-line rounded-xl px-3 py-2.5 leading-relaxed">
          {explanation}
        </div>
      )}

      <div className="grid gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => setSelected(opt)}
            className={`text-left px-4 py-3 rounded-xl border transition-colors ${
              selected === opt
                ? 'border-signal bg-signal/10 text-ink'
                : 'border-line hover:border-ink/30 text-ink/80'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {showOtherInput && (
        <textarea
          autoFocus
          value={otherText}
          onChange={(e) => setOtherText(e.target.value)}
          placeholder="Tell us more — a sentence or two is fine..."
          className="mt-3 w-full border border-line rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-signal/40"
          rows={3}
        />
      )}

      <div className="flex justify-end mt-5">
        <button
          onClick={handleContinue}
          disabled={!canContinue}
          className="px-5 py-2.5 rounded-xl bg-ink text-paper text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
