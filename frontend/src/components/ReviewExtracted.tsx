import React, { useState } from 'react'
import { ExtractedAnswer } from '../types'

interface ReviewExtractedProps {
  items: ExtractedAnswer[]
  onConfirm: (finalItems: ExtractedAnswer[]) => void
}

export default function ReviewExtracted({ items, onConfirm }: ReviewExtractedProps) {
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
    <div className="bg-white border border-line rounded-2xl p-6 shadow-sm animate-fade-in">
      <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-amber bg-amber/10 px-2 py-1 rounded-full">
        Found in your document
      </span>
      <h2 className="font-display text-lg font-semibold mt-4 mb-1 text-ink">
        We picked up {items.length} answer{items.length === 1 ? '' : 's'} already
      </h2>
      <p className="text-sm text-ink/50 mb-5">
        Review and edit anything that's not quite right — these will be
        marked as confirmed once you continue, so nothing gets asked twice.
      </p>

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.questionId} className="border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-signal">
                {item.domain}
              </span>
              <span className="text-[10px] text-ink/30">from your document</span>
            </div>
            <div className="text-sm text-ink/70 mb-2">{item.question}</div>
            <input
              type="text"
              value={values[item.questionId]}
              onChange={(e) => update(item.questionId, e.target.value)}
              className="w-full border border-line rounded-lg p-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-signal/40"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={handleConfirm}
          className="px-5 py-2.5 rounded-xl bg-ink text-paper text-sm font-medium hover:bg-ink/90 transition-colors"
        >
          Looks good, continue
        </button>
      </div>
    </div>
  )
}
