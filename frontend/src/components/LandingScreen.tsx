import React from 'react'

interface LandingScreenProps {
  onSelect: (path: 'client' | 'consultant') => void
}

export default function LandingScreen({ onSelect }: LandingScreenProps) {
  return (
    <div className="w-full max-w-3xl animate-fade-in">
      <header className="mb-12 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white font-display font-bold text-2xl mb-6 shadow-lg shadow-purple-500/50 animate-glow-pulse">
          🗺️
        </div>
        <p className="quest-chapter mb-3">
          ✨ The Discovery Quest Begins ✨
        </p>
        <h1 className="font-display text-4xl font-bold mb-4 tracking-tight quest-title">
          Project Nexus: Requirements Uncovered
        </h1>
        <p className="text-violet-50 text-base max-w-xl mx-auto leading-relaxed">
          Embark on a guided journey to uncover the hidden requirements of your project. Every answer shapes the path forward.
        </p>
      </header>

      <div className="grid sm:grid-cols-2 gap-6">
        <button
          onClick={() => onSelect('client')}
          className="quest-card rounded-2xl p-8 hover:scale-105 transition-transform duration-300 group text-left"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center mb-4 text-white font-display font-bold text-lg shadow-lg shadow-blue-500/50">
            ⚔️
          </div>
          <h2 className="font-display font-bold text-violet-50 mb-2 text-lg glow-text">Adventurer Path</h2>
          <p className="text-violet-100 text-sm leading-relaxed mb-4">
            You hold the vision. Describe your project, share your documents, then embark on adaptive questions tailored to your role.
          </p>
          <span className="inline-block text-sm font-semibold text-cyan-100 group-hover:translate-x-1 transition-transform">
            Begin your quest →
          </span>
        </button>

        <button
          onClick={() => onSelect('consultant')}
          className="quest-card rounded-2xl p-8 hover:scale-105 transition-transform duration-300 group text-left"
        >
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center mb-4 text-white font-display font-bold text-lg shadow-lg shadow-amber-500/50">
            🔮
          </div>
          <h2 className="font-display font-bold text-violet-50 mb-2 text-lg glow-text">Sage Path</h2>
          <p className="text-violet-100 text-sm leading-relaxed mb-4">
            You guide others. Review sessions, identify gaps, and weave responses into a comprehensive discovery report.
          </p>
          <span className="inline-block text-sm font-semibold text-amber-100 group-hover:translate-x-1 transition-transform">
            Enter your chamber →
          </span>
        </button>
      </div>

      <div className="mt-12 pt-8 border-t border-purple-900/50 text-center">
        <p className="text-violet-100 text-xs uppercase tracking-wider">
          🌟 Every great project starts with clear requirements 🌟
        </p>
      </div>
    </div>
  )
}
