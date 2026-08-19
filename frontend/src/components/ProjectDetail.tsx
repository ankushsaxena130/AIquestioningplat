import React, { useEffect, useState } from 'react'
import { API_BASE } from "../config";
import { Contradiction, FeedbackRecord, GapPrediction, ProjectFull, SimilarProject } from '../types'

interface ProjectDetailProps {
  projectId: string
  fallback?: ProjectFull
  token: string | null
  onBack: () => void
}

function readinessColor(score: number) {
  if (score >= 80) return '#2F6F5E'
  if (score >= 55) return '#C98A3A'
  return '#C24444'
}

function ReadinessRing({ score }: { score: number }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - score / 100)
  const color = readinessColor(score)
  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
        <circle cx="40" cy="40" r={radius} stroke="#DEDAD0" strokeWidth="8" fill="none" />
        <circle
          cx="40" cy="40" r={radius} stroke={color} strokeWidth="8" fill="none" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-display text-xl font-bold" style={{ color }}>{score}%</span>
      </div>
    </div>
  )
}

function gapColor(prob: number) {
  if (prob >= 0.7) return { bar: '#C24444', text: 'text-red-500' }
  if (prob >= 0.4) return { bar: '#C98A3A', text: 'text-amber' }
  return { bar: '#2F6F5E', text: 'text-signal' }
}

export default function ProjectDetail({ projectId, fallback, token, onBack }: ProjectDetailProps) {
  const [project, setProject] = useState<ProjectFull | null>(fallback ?? null)
  const [loading, setLoading] = useState(!fallback)
  const [gaps, setGaps] = useState<GapPrediction[]>([])
  const [similar, setSimilar] = useState<SimilarProject[]>([])
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([])
  const [contradictions, setContradictions] = useState<Contradiction[]>([])
  const [contradictionsChecked, setContradictionsChecked] = useState(false)

  useEffect(() => {
    if (!fallback) {
      fetch(`${API_BASE}/projects/${projectId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setProject)
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    fetch(`${API_BASE}/projects/${projectId}/gaps`).then((r) => r.ok && r.json()).then((d) => d && setGaps(d)).catch(() => {})
    fetch(`${API_BASE}/projects/${projectId}/similar`).then((r) => r.ok && r.json()).then((d) => d && setSimilar(d)).catch(() => {})
    fetch(`${API_BASE}/projects/${projectId}/feedback`).then((r) => r.ok && r.json()).then((d) => d && setFeedback(d)).catch(() => {})
    fetch(`${API_BASE}/projects/${projectId}/contradictions`)
      .then((r) => r.ok && r.json())
      .then((d) => {
        if (d) {
          setContradictions(d.contradictions || [])
          setContradictionsChecked(d.checked)
        }
      })
      .catch(() => {})
  }, [projectId, fallback, token])

  async function sendFeedback(targetType: string, targetId: string, action: string, modelScore?: number) {
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, action, modelScore })
      })
      if (res.ok) {
        const record = await res.json()
        setFeedback((prev) => [...prev, record])
      }
    } catch {
      // backend not running — feedback just won't be recorded this time
    }
  }

  function feedbackFor(targetType: string, targetId: string) {
    return feedback.filter((f) => f.targetType === targetType && f.targetId === targetId).slice(-1)[0]
  }

  if (loading) return <div className="text-sm text-ink/50">Loading project…</div>
  if (!project) {
    return (
      <div className="text-sm text-ink/50">
        Couldn't load this project. <button onClick={onBack} className="text-signal hover:underline">Go back</button>
      </div>
    )
  }

  const domains: Record<string, typeof project.answers> = {}
  project.answers.forEach((a) => {
    domains[a.domain] = domains[a.domain] || []
    domains[a.domain].push(a)
  })
  const coveredDomains = Object.keys(domains)
  const gapCount = project.total - project.answered

  return (
    <div className="w-full max-w-3xl animate-fade-in">
      <button onClick={onBack} className="text-sm text-ink/50 hover:text-ink transition-colors mb-6">
        ← Back to projects
      </button>

      <div className="bg-white border border-line rounded-2xl p-6 mb-6 flex items-center gap-6">
        <ReadinessRing score={project.readiness} />
        <div className="flex-1">
          <div className="font-display text-xl font-bold text-ink">{project.name}</div>
          <div className="text-sm text-ink/50 mt-0.5">{project.role} · submitted {project.createdAt}</div>
          <div className="flex gap-5 mt-3 text-xs text-ink/60">
            <span>{project.answered} of {project.total} answered</span>
            <span>{coveredDomains.length} domains covered</span>
            {gapCount > 0 && <span className="text-amber font-medium">{gapCount} still open</span>}
          </div>
        </div>
        <a
          href={`${API_BASE}/projects/${project.id}/report`}
          target="_blank" rel="noreferrer"
          className="px-4 py-2.5 rounded-xl bg-ink text-paper text-sm font-medium hover:bg-ink/90 transition-colors whitespace-nowrap"
        >
          Download PDF
        </a>
      </div>

      {contradictionsChecked && contradictions.length > 0 && (
        <div className="bg-white border border-amber/40 rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-semibold text-ink text-sm">⚠ Contradictions Found</h3>
            <span className="text-[10px] text-ink/30 font-mono uppercase">LLM + validation</span>
          </div>
          <p className="text-xs text-ink/40 mb-4">
            These answers conflict — resolve with the client before finalizing, don't silently pick one.
          </p>
          <div className="space-y-4">
            {contradictions.map((c) => {
              const fb = feedbackFor('contradiction', c.id)
              return (
                <div key={c.id} className="border border-line rounded-xl p-4">
                  <div className="grid sm:grid-cols-2 gap-3 mb-2">
                    <div>
                      <div className="text-[10px] text-ink/40 uppercase font-mono mb-0.5">{c.domainA}</div>
                      <div className="text-xs text-ink/60 mb-0.5">{c.questionA}</div>
                      <div className="text-sm font-medium text-ink">{c.answerA}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink/40 uppercase font-mono mb-0.5">{c.domainB}</div>
                      <div className="text-xs text-ink/60 mb-0.5">{c.questionB}</div>
                      <div className="text-sm font-medium text-ink">{c.answerB}</div>
                    </div>
                  </div>
                  <p className="text-xs text-amber mb-2">{c.explanation}</p>
                  {fb ? (
                    <span className="text-[11px] text-ink/40">Marked "{fb.action.replace('_', ' ')}" by consultant</span>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendFeedback('contradiction', c.id, 'resolved')}
                        className="text-[11px] px-2 py-1 rounded-md border border-line hover:border-signal hover:text-signal transition-colors"
                      >
                        Mark resolved
                      </button>
                      <button
                        onClick={() => sendFeedback('contradiction', c.id, 'not_applicable')}
                        className="text-[11px] px-2 py-1 rounded-md border border-line hover:border-ink/40 transition-colors"
                      >
                        Not a real conflict
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="bg-white border border-line rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-semibold text-ink text-sm">AI Gap Predictions</h3>
            <span className="text-[10px] text-ink/30 font-mono uppercase">
              {gaps[0]?.method === 'xgboost' ? 'xgboost model' : 'rule-based'}
            </span>
          </div>
          <p className="text-xs text-ink/40 mb-4">
            {gaps[0]?.method === 'xgboost'
              ? 'Predicted by a trained model that updates as consultants approve or flag gaps below — it genuinely learns from your calls.'
              : 'Probability each domain is under-defined for this role. Approve or flag each one — your calls become the labeled data a trained model learns from.'}
          </p>
          <div className="space-y-3">
            {gaps.map((g) => {
              const { bar, text } = gapColor(g.gapProbability)
              const fb = feedbackFor('gap', g.domain)
              return (
                <div key={g.domain}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-ink">{g.domain}</span>
                    <span className={`text-xs font-mono ${text}`}>{Math.round(g.gapProbability * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-line overflow-hidden mb-1.5">
                    <div className="h-full rounded-full" style={{ width: `${g.gapProbability * 100}%`, background: bar }} />
                  </div>
                  {fb ? (
                    <span className="text-[11px] text-ink/40">
                      Marked "{fb.action.replace('_', ' ')}" by consultant
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => sendFeedback('gap', g.domain, 'approve', g.gapProbability)}
                        className="text-[11px] px-2 py-1 rounded-md border border-line hover:border-signal hover:text-signal transition-colors"
                      >
                        Confirm real gap
                      </button>
                      <button
                        onClick={() => sendFeedback('gap', g.domain, 'not_applicable', g.gapProbability)}
                        className="text-[11px] px-2 py-1 rounded-md border border-line hover:border-ink/40 transition-colors"
                      >
                        Not applicable
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {similar.length > 0 && (
        <div className="bg-white border border-line rounded-2xl p-5 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display font-semibold text-ink text-sm">Similar Projects</h3>
            <span className="text-[10px] text-ink/30 font-mono uppercase">domain overlap</span>
          </div>
          <p className="text-xs text-ink/40 mb-3">
            Based on shared requirement domains — a stand-in for real embedding search until there's enough volume to justify it.
          </p>
          <div className="space-y-2">
            {similar.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-ink">{s.name} <span className="text-ink/40 text-xs">· {s.role}</span></span>
                <span className="font-mono text-xs text-signal">{Math.round(s.similarity * 100)}% overlap</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4">
        {Object.entries(domains).map(([domain, items]) => (
          <div key={domain} className="bg-white border border-line rounded-2xl p-5">
            <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-signal bg-signal/10 px-2 py-1 rounded-full mb-3">
              {domain}
            </span>
            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.questionId} className="border-t border-line/70 pt-3 first:border-t-0 first:pt-0">
                  <div className="text-xs text-ink/50 mb-0.5">{item.question}</div>
                  <div className="text-sm font-medium text-ink">{item.answer}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
