import React, { useState, useEffect } from 'react'

interface SageGuideProps {
  message: string
  expression?: 'neutral' | 'thinking' | 'encouraging' | 'celebrating'
  show?: boolean
}

const EXPRESSIONS = {
  neutral: '🧙‍♂️',
  thinking: '🤔',
  encouraging: '⚡',
  celebrating: '✨',
}

const MESSAGES = [
  {
    text: 'Magnificent! Your vision becomes clearer with each answer.',
    type: 'encouraging',
  },
  {
    text: 'Interesting... let me weave this knowledge together.',
    type: 'thinking',
  },
  {
    text: 'Excellent! The path forward reveals itself.',
    type: 'celebrating',
  },
  {
    text: 'Ah, I see the blueprint taking shape.',
    type: 'encouraging',
  },
  {
    text: 'This reveals much about your quest. Tell me more.',
    type: 'thinking',
  },
  {
    text: 'Perfect! This will forge a legendary project.',
    type: 'celebrating',
  },
  {
    text: 'Wise choice. The quest progresses beautifully.',
    type: 'encouraging',
  },
  {
    text: 'Fascinating constraints. They strengthen your foundation.',
    type: 'neutral',
  },
]

export default function SageGuide({ message, expression = 'neutral', show = true }: SageGuideProps) {
  const [displayMessage, setDisplayMessage] = useState('')
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    if (message) {
      setDisplayMessage(message)
    } else {
      // Cycle through default messages
      const timer = setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % MESSAGES.length)
        setDisplayMessage(MESSAGES[messageIndex].text)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [message, messageIndex])

  if (!show) return null

  return (
    <div className="flex gap-4 mb-6 items-start animate-slide-in-right">
      {/* Sage Avatar */}
      <div className="text-4xl flex-shrink-0 drop-shadow-lg">
        {EXPRESSIONS[expression]}
      </div>
      
      {/* Message Bubble */}
      <div className="flex-1 bg-gradient-to-br from-purple-900/40 to-indigo-900/30 border-2 border-purple-500/40 rounded-xl px-5 py-4 shadow-lg">
        <p className="text-sm text-purple-100 leading-relaxed font-medium">
          {displayMessage}
        </p>
        
        {/* Thinking dots */}
        <div className="flex gap-1.5 mt-3">
          <div className="w-2 h-2 rounded-full bg-cyan-400/60"></div>
          <div className="w-2 h-2 rounded-full bg-cyan-400/60 animate-pulse"></div>
          <div className="w-2 h-2 rounded-full bg-cyan-400/60"></div>
        </div>
      </div>
    </div>
  )
}
