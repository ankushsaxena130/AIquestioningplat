import React, { useState } from 'react'
import { ExtractedAnswer } from '../types'

interface ReviewExtractedProps {
  items: ExtractedAnswer[]
  onConfirm: (finalItems: ExtractedAnswer[]) => void
  onBack?: () => void
}

export default function ReviewExtracted({ items, onConfirm, onBack }: ReviewExtractedProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(items.map((i) => [i.questionId, i.answer]))
  )

  function update(questionId: string, val: string) {
    setValues((prev) => ({ ...prev, [questionId]: val }))
  }

  function handleConfirm() {
    onConfirm(items.map((i) => ({ ...i, answer: values[i.questionId] })))
  }

  return (
    <div className="bg-violet-950/30 border border-violet-400/30 rounded-2xl p-6 shadow-sm animate-fade-in">
      {onBack && (
        <button
          onClick={onBack}
          className="text-sm text-violet-200/80 hover:text-violet-50 transition-colors mb-4 inline-flex items-center gap-1"
        >
          ← Back
        </button>
      )}
      <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-amber-100 bg-amber-500/10 px-2 py-1 rounded-full">
        Found in your document
      </span>
      <h2 className="font-display text-lg font-semibold mt-4 mb-1 text-violet-50">
        We picked up {items.length} answer{items.length === 1 ? '' : 's'} already
      </h2>
      <p className="text-sm text-violet-200/80 mb-5">
        Review and edit anything that's not quite right — these will be
        marked as confirmed once you continue, so nothing gets asked twice.
      </p>

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.questionId} className="border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-violet-200">
                {item.domain}
              </span>
              <span className="text-[10px] text-violet-200/60">from your document</span>
            </div>
            <div className="text-sm text-violet-100 mb-2">{item.question}</div>
            <input
              type="text"
              value={values[item.questionId]}
              onChange={(e) => update(item.questionId, e.target.value)}
              className="w-full border border-violet-400/30 rounded-lg p-2.5 text-sm font-medium text-violet-50 bg-violet-950/20 focus:outline-none focus:ring-2 focus:ring-violet-400/40"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={handleConfirm}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 text-white text-sm font-medium hover:brightness-110 transition-colors"
        >
          Looks good, continue
        </button>
      </div>
    </div>
  )
}
