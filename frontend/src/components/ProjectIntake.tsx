import React, { useRef, useState } from 'react'
import { API_BASE } from '../App'
import { ExtractedAnswer } from '../types'

interface ProjectIntakeProps {
  onContinue: (name: string, extracted: ExtractedAnswer[], sourceDocText?: string) => void
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
      onContinue(
        data.suggestedName || file.name.replace(/\.(pdf|docx)$/i, ''),
        data.extracted || [],
        data.rawText || undefined
      )
    } catch {
      setError(
        `Couldn't reach the extraction service at ${API_BASE}. Make sure the backend is running, or switch to "Type it myself" below.`
      )
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="quest-card rounded-2xl p-8 animate-fade-in max-w-2xl">
      <div className="quest-chapter mb-3">
        🗺️ CHAPTER 1: THE QUEST BEGINS
      </div>

      <h2 className="font-display text-2xl font-bold mb-2 text-white">
        What is the name of your quest?
      </h2>
      <p className="text-purple-200 text-base mb-6">
        Share your project name, or upload a brief — we'll extract key information to guide our conversation.
      </p>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6 bg-purple-900/30 border border-purple-500/30 rounded-lg p-1 w-fit">
        <button
          onClick={() => setMode('type')}
          className={`px-5 py-2 rounded-md text-sm font-semibold transition-all ${
            mode === 'type' 
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30' 
              : 'text-purple-300 hover:text-white'
          }`}
        >
          Tell me
        </button>
        <button
          onClick={() => setMode('upload')}
          className={`px-5 py-2 rounded-md text-sm font-semibold transition-all ${
            mode === 'upload' 
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/30' 
              : 'text-purple-300 hover:text-white'
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
            placeholder="e.g. 'AI Customer Support Platform'"
            className="w-full px-4 py-3 border-2 border-purple-500/30 bg-purple-900/20 text-white placeholder-purple-200 rounded-lg text-base focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/30 transition-all"
          />
          <div className="flex justify-end mt-6">
            <button
              onClick={() => name.trim() && onContinue(name.trim(), [])}
              disabled={!name.trim()}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/30 transition-all disabled:shadow-none"
            >
              ⚡ Begin Quest
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-purple-500/40 bg-purple-900/10 rounded-lg p-8 text-center cursor-pointer hover:border-cyan-400/60 hover:bg-purple-900/20 transition-all"
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
                <div className="text-base font-semibold text-cyan-300 mb-2">📋 {file.name}</div>
                <div className="text-sm text-purple-100">Click to choose a different file</div>
              </div>
            ) : (
              <div>
                <div className="text-5xl mb-4">📄</div>
                <div className="text-base font-semibold text-white mb-2">Upload your project brief</div>
                <div className="text-sm text-purple-100">PDF or DOCX — a requirements doc, SOW, or pitch deck works perfectly</div>
              </div>
            )}
          </div>

          {error && (
            <div className="mt-5 text-sm text-amber-200 bg-amber-900/40 border border-amber-500/40 rounded-lg px-4 py-3">
              ⚠️ {error}
            </div>
          )}

          <div className="flex justify-end mt-6">
            <button
              onClick={handleExtract}
              disabled={!file || extracting}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/30 transition-all disabled:shadow-none"
            >
              {extracting ? '🔮 Analyzing...' : '⚡ Extract & Begin'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
