import React from 'react'
import { Role } from '../types'

interface RoleSelectProps {
  onSelect: (role: Role) => void
  onBack?: () => void
}

const ROLES: { role: Role; blurb: string }[] = [
  { role: 'Business Owner', blurb: 'Objectives, ROI, budget, timeline' },
  { role: 'Product Manager', blurb: 'Users, features, priorities, KPIs' },
  { role: 'Technical Lead', blurb: 'Architecture, integrations, infrastructure' },
  { role: 'Data/AI Lead', blurb: 'Data sources, AI/ML requirements' },
  { role: 'Security/Compliance', blurb: 'Auth, PII, compliance, access control' },
  { role: 'IT/Infrastructure', blurb: 'Hosting, uptime, monitoring, DR' }
]

export default function RoleSelect({ onSelect, onBack }: RoleSelectProps) {
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
      <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-violet-100 bg-violet-500/10 px-2 py-1 rounded-full">
        Getting started
      </span>

      <h2 className="font-display text-lg font-semibold mt-4 mb-1 text-violet-50">
        What's your role in this project?
      </h2>
      <p className="text-sm text-violet-200/80 mb-5">
        This determines which questions you'll see next.
      </p>

      <div className="grid gap-2">
        {ROLES.map(({ role, blurb }) => (
          <button
            key={role}
            onClick={() => onSelect(role)}
            className="flex items-center justify-between text-left border border-violet-400/20 rounded-xl px-4 py-3 hover:border-violet-300 hover:bg-violet-500/5 transition-colors group"
          >
            <div>
              <div className="font-medium text-violet-50 text-sm">{role}</div>
              <div className="text-xs text-violet-200/70 mt-0.5">{blurb}</div>
            </div>
            <span className="text-violet-200/60 group-hover:text-violet-50 group-hover:translate-x-0.5 transition-all">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
