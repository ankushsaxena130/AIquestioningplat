import React, { useRef, useState } from 'react'
import { API_BASE } from '../App'
import { ExtractedAnswer } from '../types'

interface ProjectIntakeProps {
  onContinue: (name: string, extracted: ExtractedAnswer[]) => void
}

export default function ProjectIntake({ onContinue }: ProjectIntakeProps) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'type' | 'upload'>('type')
  const [file, setFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExtract() {
    if (!file) return
    setExtracting(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/extract`, { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Extraction failed')
      const data = await res.json()
      onContinue(data.suggestedName || file.name.replace(/\.(pdf|docx)$/i, ''), data.extracted || [])
    } catch {
      setError(
        `Couldn't reach the extraction service at ${API_BASE}. Make sure the backend is running, or switch to "Type it myself" below.`
      )
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="bg-white border border-line rounded-2xl p-6 shadow-sm animate-fade-in">
      <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-signal bg-signal/10 px-2 py-1 rounded-full">
        Question 1
      </span>

      <h2 className="font-display text-lg font-semibold mt-4 mb-1 text-ink">
        What's the name of your project?
      </h2>
      <p className="text-sm text-ink/50 mb-5">
        Or upload a project brief and we'll pull the name and answer what we
        can from it — you'll get to review everything before it's used.
      </p>

      <div className="flex gap-1 mb-5 bg-paper border border-line rounded-xl p-1 w-fit">
        <button
          onClick={() => setMode('type')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'type' ? 'bg-ink text-paper' : 'text-ink/50 hover:text-ink'
          }`}
        >
          Type it myself
        </button>
        <button
          onClick={() => setMode('upload')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            mode === 'upload' ? 'bg-ink text-paper' : 'text-ink/50 hover:text-ink'
          }`}
        >
          Upload a document
        </button>
      </div>

      {mode === 'type' ? (
        <>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onContinue(name.trim(), [])}
            placeholder="e.g. AI Customer Support Platform"
            className="w-full border border-line rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-signal/40"
          />
          <div className="flex justify-end mt-5">
            <button
              onClick={() => name.trim() && onContinue(name.trim(), [])}
              disabled={!name.trim()}
              className="px-5 py-2.5 rounded-xl bg-ink text-paper text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors"
            >
              Continue
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-line rounded-xl p-6 text-center cursor-pointer hover:border-signal hover:bg-signal/5 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <div className="text-sm font-medium text-ink">{file.name}</div>
                <div className="text-xs text-ink/40 mt-1">Click to choose a different file</div>
              </div>
            ) : (
              <div>
                <div className="text-2xl mb-2">📄</div>
                <div className="text-sm font-medium text-ink">Click to upload a .pdf or .docx</div>
                <div className="text-xs text-ink/40 mt-1">A project brief, SOW, or requirements doc works well</div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-3 text-xs text-amber bg-amber/10 border border-amber/30 rounded-xl px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end mt-5">
            <button
              onClick={handleExtract}
              disabled={!file || extracting}
              className="px-5 py-2.5 rounded-xl bg-ink text-paper text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors"
            >
              {extracting ? 'Reading document…' : 'Extract & continue'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
