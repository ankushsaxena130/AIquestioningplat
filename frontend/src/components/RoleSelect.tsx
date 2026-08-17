import React from 'react'
import { Role } from '../types'

interface RoleSelectProps {
  onSelect: (role: Role) => void
}

const ROLES: { role: Role; blurb: string }[] = [
  { role: 'Business Owner', blurb: 'Objectives, ROI, budget, timeline' },
  { role: 'Product Manager', blurb: 'Users, features, priorities, KPIs' },
  { role: 'Technical Lead', blurb: 'Architecture, integrations, infrastructure' },
  { role: 'Data/AI Lead', blurb: 'Data sources, AI/ML requirements' },
  { role: 'Security/Compliance', blurb: 'Auth, PII, compliance, access control' },
  { role: 'IT/Infrastructure', blurb: 'Hosting, uptime, monitoring, DR' }
]

export default function RoleSelect({ onSelect }: RoleSelectProps) {
  return (
    <div className="bg-white border border-line rounded-2xl p-6 shadow-sm animate-fade-in">
      <span className="inline-block font-mono text-[11px] uppercase tracking-wide text-signal bg-signal/10 px-2 py-1 rounded-full">
        Getting started
      </span>

      <h2 className="font-display text-lg font-semibold mt-4 mb-1 text-ink">
        What's your role in this project?
      </h2>
      <p className="text-sm text-ink/50 mb-5">
        This determines which questions you'll see next.
      </p>

      <div className="grid gap-2">
        {ROLES.map(({ role, blurb }) => (
          <button
            key={role}
            onClick={() => onSelect(role)}
            className="flex items-center justify-between text-left border border-line rounded-xl px-4 py-3 hover:border-signal hover:bg-signal/5 transition-colors group"
          >
            <div>
              <div className="font-medium text-ink text-sm">{role}</div>
              <div className="text-xs text-ink/50 mt-0.5">{blurb}</div>
            </div>
            <span className="text-ink/30 group-hover:text-signal group-hover:translate-x-0.5 transition-all">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
