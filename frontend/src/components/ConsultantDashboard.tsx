import React, { useEffect, useState } from 'react'
import { API_BASE } from '../App'
import { ProjectFull, ProjectSummary } from '../types'
import ProjectDetail from './ProjectDetail'

interface ConsultantDashboardProps {
  token: string | null
  onBack: () => void
  onLogout: () => void
}

const MOCK_PROJECTS: ProjectFull[] = [
  {
    id: 'mock-1',
    name: 'AI Customer Support Platform',
    role: 'Technical Lead',
    readiness: 78,
    answered: 7,
    total: 9,
    createdAt: '2026-08-10',
    answers: [
      { questionId: 'Q-TECH-001', domain: 'Integrations', question: 'What should this system integrate with?', answer: 'CRM' },
      { questionId: 'Q-INFRA-002', domain: 'Deployment', question: 'Where should this be deployed?', answer: 'AWS' },
      { questionId: 'Q-SEC-014', domain: 'Security', question: 'Do you already have an authentication system in place?', answer: 'Yes - Azure AD' },
      { questionId: 'Q-TECH-004', domain: 'Non-Functional Requirements', question: 'Expected concurrent users at peak?', answer: '500 - 5,000' }
    ]
  },
  {
    id: 'mock-2',
    name: 'Internal Analytics Rebuild',
    role: 'Data/AI Lead',
    readiness: 54,
    answered: 5,
    total: 9,
    createdAt: '2026-08-08',
    answers: [
      { questionId: 'Q-DATA-001', domain: 'Data', question: 'What type of data will the system process?', answer: 'Internal business information' },
      { questionId: 'Q-DATA-002', domain: 'AI/ML', question: 'Do you have existing training data?', answer: 'Yes, but messy' }
    ]
  },
  {
    id: 'mock-3',
    name: 'Patient Intake Chatbot',
    role: 'Security/Compliance',
    readiness: 91,
    answered: 8,
    total: 9,
    createdAt: '2026-08-05',
    answers: [
      { questionId: 'Q-COMP-001', domain: 'Compliance', question: 'Specific compliance requirements?', answer: 'HIPAA' },
      { questionId: 'Q-SEC-014', domain: 'Security', question: 'Authentication system in place?', answer: 'Yes - Okta' }
    ]
  }
]

function readinessColor(score: number) {
  if (score >= 80) return 'text-signal'
  if (score >= 55) return 'text-amber'
  return 'text-red-500'
}

export default function ConsultantDashboard({ token, onBack, onLogout }: ConsultantDashboardProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>(MOCK_PROJECTS)
  const [usingMock, setUsingMock] = useState(true)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/projects`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ProjectSummary[]) => {
        if (data.length > 0) {
          setProjects(data)
          setUsingMock(false)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  if (openId) {
    const mockMatch = MOCK_PROJECTS.find((p) => p.id === openId)
    return <ProjectDetail projectId={openId} fallback={mockMatch} token={token} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="w-full max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-violet-200/80 mb-1">Consultant Dashboard</p>
          <h1 className="font-display text-2xl font-bold text-violet-50">Active projects</h1>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={onLogout} className="text-xs text-violet-200/60 hover:text-violet-50 transition-colors">
            Log out
          </button>
          <button onClick={onBack} className="text-sm text-violet-200/80 hover:text-violet-50 transition-colors">
            ← Back
          </button>
        </div>
      </div>

      {usingMock && !loading && (
        <div className="mb-4 text-xs text-amber-100 bg-amber-500/10 border border-amber-400/30 rounded-xl px-3 py-2">
          Showing sample data — the backend at {API_BASE} isn't reachable, so real client submissions won't appear yet.
        </div>
      )}

      <div className="grid gap-3">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setOpenId(p.id)}
            className="w-full text-left bg-violet-950/30 border border-violet-400/30 rounded-2xl p-5 flex items-center justify-between hover:border-violet-300 hover:shadow-sm transition-all"
          >
            <div>
              <div className="font-display font-semibold text-violet-50">{p.name}</div>
              <div className="text-xs text-violet-200/70 mt-0.5">{p.role} · {p.createdAt}</div>
              <div className="flex gap-4 mt-3 text-xs text-violet-200/80">
                <span>{p.answered} of {p.total} answered</span>
              </div>
            </div>
            <div className="text-right shrink-0 ml-4">
              <div className={`font-display text-2xl font-bold ${readinessColor(p.readiness)}`}>{p.readiness}%</div>
              <div className="text-[11px] text-violet-200/70 uppercase tracking-wide">readiness</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
