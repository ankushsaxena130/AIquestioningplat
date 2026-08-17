import React, { useEffect, useState } from 'react'

interface GameProgressProps {
  level: number
  xp: number
  nextLevelXP: number
  streak: number
  totalAnswered: number
}

export default function GameProgress({
  level,
  xp,
  nextLevelXP,
  streak,
  totalAnswered,
}: GameProgressProps) {
  const xpPercent = Math.min((xp / nextLevelXP) * 100, 100)
  const [showStreakAnimation, setShowStreakAnimation] = useState(false)

  useEffect(() => {
    if (streak > 0) {
      setShowStreakAnimation(true)
      const timer = setTimeout(() => setShowStreakAnimation(false), 400)
      return () => clearTimeout(timer)
    }
  }, [streak])

  return (
    <div className="quest-card rounded-xl p-5 mb-6 animate-fade-in">
      <div className="grid grid-cols-4 gap-4">
        {/* Level Badge */}
        <div className="flex flex-col items-center">
          <div className="level-badge w-16 h-16 mb-2 text-xl font-display">
            {level}
          </div>
          <div className="text-xs text-purple-100 uppercase font-semibold tracking-wider">
            Level
          </div>
        </div>

        {/* XP Bar */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono uppercase text-purple-100 tracking-wider">
              Experience
            </span>
            <span className="text-xs font-mono font-bold text-cyan-200">
              {xp} / {nextLevelXP}
            </span>
          </div>
          <div className="xp-bar rounded-full overflow-hidden">
            <div
              className="xp-bar-fill transition-all duration-500 ease-out rounded-full"
              style={{ width: `${xpPercent}%` }}
            />
          </div>
          <p className="text-xs text-purple-200 mt-1.5">
            {Math.max(0, nextLevelXP - xp)} more for next level
          </p>
        </div>

        {/* Streak Indicator */}
        <div className="flex flex-col items-center">
          {streak > 0 && (
            <div
              className={`streak-indicator mb-2 ${
                showStreakAnimation ? 'animate-streak-bounce' : ''
              }`}
            >
              <span>🔥</span>
              <span>{streak}</span>
            </div>
          )}
          {streak === 0 && (
            <div className="w-full h-8 flex items-center justify-center text-xs text-purple-300">
              —
            </div>
          )}
          <div className="text-xs text-purple-100 uppercase font-semibold tracking-wider">
            Streak
          </div>
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="mt-4 pt-4 border-t border-purple-500/30 grid grid-cols-2 gap-4">
        <div className="text-center">
          <div className="text-2xl font-display font-bold text-cyan-200">
            {totalAnswered}
          </div>
          <div className="text-xs text-purple-100 uppercase font-semibold tracking-wider mt-1">
            Questions Answered
          </div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-display font-bold text-amber-300">
            {Math.round(xpPercent)}%
          </div>
          <div className="text-xs text-purple-100 uppercase font-semibold tracking-wider mt-1">
            Progress to Next
          </div>
        </div>
      </div>
    </div>
  )
}
