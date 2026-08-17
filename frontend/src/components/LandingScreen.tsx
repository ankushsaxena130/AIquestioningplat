import React from 'react'

interface LandingScreenProps {
  onSelect: (path: 'client' | 'consultant') => void
}

export default function LandingScreen({ onSelect }: LandingScreenProps) {
  return (
    <div className="w-full max-w-2xl animate-fade-in">
      <header className="mb-10 text-center">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-ink text-paper font-display font-bold text-lg mb-5">
          D
        </div>
        <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-2">
          Requirement Discovery Platform
        </p>
        <h1 className="font-display text-3xl font-bold text-ink mb-3 tracking-tight">
          Let's find out what this project actually needs
        </h1>
        <p className="text-ink/60 text-sm max-w-md mx-auto leading-relaxed">
          A short, adaptive interview that surfaces the requirements clients
          usually forget to mention — before development begins.
        </p>
      </header>

      <div className="grid sm:grid-cols-2 gap-4">
        <button
          onClick={() => onSelect('client')}
          className="text-left bg-white border border-line rounded-2xl p-6 hover:border-signal hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
        >
          <div className="w-10 h-10 rounded-full bg-signal/10 flex items-center justify-center mb-4 text-signal font-display font-semibold">
            C
          </div>
          <h2 className="font-display font-semibold text-ink mb-1.5">I'm a Client</h2>
          <p className="text-sm text-ink/60 leading-relaxed">
            Tell us about your project — or upload a document — then answer a
            short set of questions tailored to your role.
          </p>
          <span className="inline-block mt-4 text-sm font-medium text-signal group-hover:translate-x-0.5 transition-transform">
            Start a discovery session →
          </span>
        </button>

        <button
          onClick={() => onSelect('consultant')}
          className="text-left bg-white border border-line rounded-2xl p-6 hover:border-ink hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 group"
        >
          <div className="w-10 h-10 rounded-full bg-ink/10 flex items-center justify-center mb-4 text-ink font-display font-semibold">
            K
          </div>
          <h2 className="font-display font-semibold text-ink mb-1.5">I'm a Consultant</h2>
          <p className="text-sm text-ink/60 leading-relaxed">
            Review sessions, resolve gaps and contradictions, and generate
            the final report.
          </p>
          <span className="inline-block mt-4 text-sm font-medium text-ink group-hover:translate-x-0.5 transition-transform">
            Open dashboard →
          </span>
        </button>
      </div>
    </div>
  )
}
