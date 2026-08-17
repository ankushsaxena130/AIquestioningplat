import React, { useEffect, useMemo, useRef, useState } from 'react'
import DiscoveryProgress, { ProgressMood } from './components/DiscoveryProgress'
import QuestionCard from './components/QuestionCard'
import ProjectIntake from './components/ProjectIntake'
import ReviewExtracted from './components/ReviewExtracted'
import RoleSelect from './components/RoleSelect'
import LandingScreen from './components/LandingScreen'
import ConsultantDashboard from './components/ConsultantDashboard'
import GameProgress from './components/GameProgress'
import SageGuide from './components/SageGuide'
import { detectIndustries, questionsForRole, selectNextQuestion } from './data/questionBank'
import { AnswerRecord, ExtractedAnswer, QuestionDef, Role, Screen } from './types'

export const API_BASE = 'http://localhost:8000'

function mockConfidence(wasOther: boolean, text: string): number {
  if (!wasOther) return 0.95
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words >= 5) return 0.8
  if (words >= 2) return 0.5
  return 0.25
}

const CONFIDENCE_THRESHOLD = 0.6

const CONFIDENT_MESSAGES = [
  "Got it, that's clear.",
  'Perfect, that resolves this one.',
  'Nice, making good progress.',
  'Great, almost there!',
  "That's exactly what we needed."
]

const THINKING_MESSAGES = [
  "Hmm, I'm not fully sure I caught that — could you say a bit more?",
  "That's a little ambiguous — want to add some detail?",
  "I don't want to guess here — can you clarify?"
]

type Step = 'name' | 'review-extracted' | 'role' | 'bank'

export default function App() {
  const [screen, setScreen] = useState<Screen>('landing')

  const [step, setStep] = useState<Step>('name')
  const [projectName, setProjectName] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [extracted, setExtracted] = useState<ExtractedAnswer[]>([])
  const [sourceDocText, setSourceDocText] = useState<string | undefined>(undefined)
  const [answers, setAnswers] = useState<AnswerRecord[]>([])
  const [answeredIds, setAnsweredIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [finalSummary, setFinalSummary] = useState<string | null>(null)

  // dynamic (open-ended, no fixed threshold) question state
  const [dynamicQuestion, setDynamicQuestion] = useState<QuestionDef | null>(null)
  const [dynamicPhaseDone, setDynamicPhaseDone] = useState(false)
  const [dynamicAskedCount, setDynamicAskedCount] = useState(0)
  const [totalEstimate, setTotalEstimate] = useState(0)
  const fetchingRef = useRef(false)

  // Hard safety cap — defense in depth. The backend's own prompt already
  // instructs Grok to stop after ~6 extra questions, but if the model ever
  // misbehaves (bad response, ignores the instruction), this guarantees
  // the session still terminates instead of calling the API forever.
  const MAX_DYNAMIC_QUESTIONS = 8

  const [percent, setPercent] = useState(0)
  const [mood, setMood] = useState<ProgressMood>('confident')
  const [message, setMessage] = useState("Let's get started — answer as best you can.")
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null)

  // === GAMIFICATION STATE ===
  const [xp, setXp] = useState(0)
  const [level, setLevel] = useState(1)
  const [streak, setStreak] = useState(0)
  const [lastConfidentAnswer, setLastConfidentAnswer] = useState(false)
  const streakThresholdRef = useRef(2) // Points needed to maintain streak
  const levelUpThresholdRef = useRef(100) // XP needed for next level
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [sageMessage, setSageMessage] = useState('')
  const [sageExpression, setSageExpression] = useState<'neutral' | 'thinking' | 'encouraging' | 'celebrating'>('neutral')

  const roleQuestions = useMemo(
    () => (role ? questionsForRole(role, projectName) : []),
    [role, projectName]
  )

  const bankQuestion = useMemo(() => {
    const eligible = roleQuestions.filter((q) => {
      if (answeredIds.includes(q.id)) return false
      if (q.dependsOn && !answeredIds.includes(q.dependsOn)) return false
      return true
    })
    return selectNextQuestion(eligible)
  }, [roleQuestions, answeredIds])

  const currentQuestion = bankQuestion ?? dynamicQuestion ?? undefined

  useEffect(() => {
    if (role) setTotalEstimate(roleQuestions.length)
  }, [role, roleQuestions.length])

  useEffect(() => {
    if (step !== 'bank' || !role) return
    if (bankQuestion) return
    if (dynamicQuestion) return
    if (dynamicPhaseDone) return
    if (fetchingRef.current) return
    if (dynamicAskedCount >= MAX_DYNAMIC_QUESTIONS) {
      setDynamicPhaseDone(true)
      return
    }

    fetchingRef.current = true
    fetch(`${API_BASE}/next-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName,
        role,
        answeredSoFar: answers.map((a) => ({ domain: a.domain, question: a.question, answer: a.answer })),
        askedQuestions: answers.map((a) => a.question)
      })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.done) {
          setDynamicPhaseDone(true)
        } else {
          const id = `dyn-${answers.length}`
          setDynamicQuestion({
            id,
            domain: data.domain || 'Additional Detail',
            roles: [role],
            question: data.question,
            options: data.options || [],
            mandatory: true,
            category: data.category === 'ideation' ? 'ideation' : 'gap'
          })
          setDynamicAskedCount((n) => n + 1)
          setTotalEstimate((t) => t + 1)
        }
      })
      .catch(() => setDynamicPhaseDone(true))
      .finally(() => {
        fetchingRef.current = false
      })
  }, [step, role, bankQuestion, dynamicQuestion, dynamicPhaseDone, dynamicAskedCount, answers, projectName])

  const allDone = step === 'bank' && role && !bankQuestion && !dynamicQuestion && dynamicPhaseDone

  useEffect(() => {
    if (allDone && !submitting && !finalSummary) {
      finishSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone])

  function handleNameContinue(name: string, extractedAnswers: ExtractedAnswer[], docText?: string) {
    setProjectName(name)
    setExtracted(extractedAnswers)
    setSourceDocText(docText)
    setStep('role')
  }

  function handleRoleSelect(r: Role) {
    setRole(r)
    const relevant = extracted.filter((e) => questionsForRole(r, projectName).some((q) => q.id === e.questionId))
    setStep(relevant.length > 0 ? 'review-extracted' : 'bank')
  }

  function applyExtractedAnswers(finalItems: ExtractedAnswer[]) {
    const newAnswers: AnswerRecord[] = finalItems.map((i) => ({
      questionId: i.questionId,
      domain: i.domain,
      question: i.question,
      answer: i.answer
    }))
    const newIds = finalItems.map((i) => i.questionId)
    setAnswers((prev) => [...prev, ...newAnswers])
    setAnsweredIds((prev) => [...prev, ...newIds])
    setPercent(Math.round((newIds.length / Math.max(totalEstimate, newIds.length)) * 100))
    setMessage(`${newIds.length} question${newIds.length === 1 ? '' : 's'} already resolved from your document.`)
    setStep('bank')
  }

  // === XP & LEVEL UP HANDLER ===
  function handleXpEarned(points: number, wasConfident: boolean) {
    const newXp = xp + points
    setXp(newXp)

    // Update streak
    if (wasConfident) {
      if (lastConfidentAnswer) {
        setStreak((s) => s + 1)
      } else {
        setStreak(1)
      }
      setLastConfidentAnswer(true)
    } else {
      setStreak(0)
      setLastConfidentAnswer(false)
    }

    // Check for level up
    if (newXp >= levelUpThresholdRef.current) {
      const newLevel = level + 1
      setLevel(newLevel)
      setXp(newXp - levelUpThresholdRef.current)
      levelUpThresholdRef.current = newLevel * 100 // Next level requires more XP
      setShowLevelUp(true)
      setSageExpression('celebrating')
      setSageMessage(`🎉 Level ${newLevel}! You're really getting into this!`)
      setTimeout(() => setShowLevelUp(false), 2000)
    } else {
      // Show encouraging message based on answer quality
      if (points >= 10) {
        setSageExpression('celebrating')
        setSageMessage('Excellent detail! I can work with that.')
      } else if (points >= 7) {
        setSageExpression('encouraging')
        setSageMessage('Great choice!')
      } else {
        setSageExpression('thinking')
        setSageMessage('Got it, got it... give me a moment.')
      }
      setTimeout(() => setSageMessage(''), 3000)
    }
  }

  const [interpreting, setInterpreting] = useState(false)
  const [milestoneMessage, setMilestoneMessage] = useState<string | null>(null)
  const lastMilestoneRef = useRef(0)

  const MILESTONES: Record<number, string> = {
    25: "🚀 Quarter of the way there!",
    50: '🔥 Halfway done — great pace.',
    75: "🌟 Almost there, just a few more.",
    100: '🎉 All done — nice work!'
  }

  function checkMilestone(newPercent: number) {
    for (const threshold of [100, 75, 50, 25]) {
      if (newPercent >= threshold && lastMilestoneRef.current < threshold) {
        lastMilestoneRef.current = threshold
        setMilestoneMessage(MILESTONES[threshold])
        setTimeout(() => setMilestoneMessage(null), 2200)
        break
      }
    }
  }

  async function handleBankAnswer(text: string, wasOther: boolean) {
    if (!currentQuestion) return

    let confidence: number
    let finalAnswer = text

    if (!wasOther) {
      // MCQ pick from a closed set — always high confidence, no LLM call needed
      confidence = 0.95
    } else {
      // Free text ("Other") — real LLM interpretation, not a word-count guess
      setInterpreting(true)
      try {
        const res = await fetch(`${API_BASE}/interpret-answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: currentQuestion.domain, question: currentQuestion.question, freeText: text })
        })
        const data = await res.json()
        confidence = typeof data.confidence === 'number' ? data.confidence : mockConfidence(true, text)
        finalAnswer = data.answer || text
      } catch {
        // backend unreachable — fall back to the local heuristic rather than blocking
        confidence = mockConfidence(true, text)
      } finally {
        setInterpreting(false)
      }
    }

    if (confidence >= CONFIDENCE_THRESHOLD) {
      const nextAnswered = [...answeredIds, currentQuestion.id]
      setAnsweredIds(nextAnswered)
      setAnswers((prev) => [
        ...prev,
        {
          questionId: currentQuestion.id,
          domain: currentQuestion.domain,
          question: currentQuestion.question,
          answer: finalAnswer,
          category: currentQuestion.category ?? 'gap'
        }
      ])
      const nextPercent = Math.round((nextAnswered.length / Math.max(totalEstimate, nextAnswered.length)) * 100)
      setMood('confident')
      setPercent(nextPercent)
      checkMilestone(nextPercent)
      setMessage(CONFIDENT_MESSAGES[Math.min(nextAnswered.length - 1, CONFIDENT_MESSAGES.length - 1)])
      setRetryPrompt(null)
      setDynamicQuestion(null)
      
      // Award XP based on confidence
      const points = wasOther ? (confidence >= 0.8 ? 10 : confidence >= 0.5 ? 7 : 5) : 10
      handleXpEarned(points, true)
    } else {
      setMood('thinking')
      setMessage(THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)])
      setRetryPrompt('Could you rephrase that with a bit more detail? For example: a rough number, a name, or a yes/no.')
      handleXpEarned(2, false)
    }
  }

  async function finishSession() {
    setSubmitting(true)
    let summary = ''
    try {
      const sumRes = await fetch(`${API_BASE}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName,
          role,
          answers: answers.map((a) => ({
            domain: a.domain,
            question: a.question,
            answer: a.answer,
            category: a.category ?? 'gap'
          }))
        })
      })
      const sumData = await sumRes.json()
      summary = sumData.summary || ''
    } catch {
      // backend unreachable — proceed without a summary rather than blocking submission
    }
    setFinalSummary(summary)

    try {
      await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName,
          role,
          answers,
          total: answers.length,
          answered: answers.length,
          summary,
          sourceDocText
        })
      })
    } catch {
      // backend not running — session just won't reach the consultant side yet
    } finally {
      setSubmitting(false)
      setScreen('submitted')
    }
  }

  function resetToLanding() {
    lastMilestoneRef.current = 0
    setMilestoneMessage(null)
    setScreen('landing')
    setStep('name')
    setProjectName('')
    setRole(null)
    setExtracted([])
    setSourceDocText(undefined)
    setAnswers([])
    setAnsweredIds([])
    setDynamicQuestion(null)
    setDynamicPhaseDone(false)
    setDynamicAskedCount(0)
    setTotalEstimate(0)
    setFinalSummary(null)
    setPercent(0)
    setMood('confident')
    setMessage("Let's get started — answer as best you can.")
    setRetryPrompt(null)
    // Reset game state
    setXp(0)
    setLevel(1)
    setStreak(0)
    setLastConfidentAnswer(false)
    levelUpThresholdRef.current = 100
    setSageMessage('')
    setShowLevelUp(false)
  }

  const detectedIndustries = useMemo(() => detectIndustries(projectName), [projectName])

  const allRoleDomains = useMemo(() => Array.from(new Set(roleQuestions.map((q) => q.domain))), [roleQuestions])
  const understoodDomains = useMemo(
    () => allRoleDomains.filter((d) => answers.some((a) => a.domain === d)),
    [allRoleDomains, answers]
  )
  const exploringDomains = useMemo(
    () => allRoleDomains.filter((d) => !answers.some((a) => a.domain === d)),
    [allRoleDomains, answers]
  )

  return (
    <div
      className="min-h-screen flex items-start justify-center py-16 px-4 text-violet-50"
      style={{
        backgroundColor: '#12091f',
        backgroundImage:
          'radial-gradient(circle at 20% 30%, rgba(168, 85, 247, 0.22), transparent 35%), radial-gradient(circle at 80% 70%, rgba(99, 102, 241, 0.18), transparent 40%), linear-gradient(180deg, #12091f 0%, #1a1029 45%, #12091f 100%)',
        backgroundAttachment: 'fixed'
      }}
    >
      {milestoneMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-violet-900/90 text-violet-50 border border-violet-400/40 text-sm font-medium px-5 py-2.5 rounded-full shadow-lg animate-fade-in">
          {milestoneMessage}
        </div>
      )}

      {screen === 'landing' && (
        <LandingScreen onSelect={(path) => (path === 'client' ? setScreen('questions') : setScreen('consultant'))} />
      )}

      {screen === 'consultant' && <ConsultantDashboard onBack={resetToLanding} />}

      {screen === 'questions' && (
        <div className="w-full max-w-xl">
          <header className="mb-8">
            <p className="font-mono text-xs uppercase tracking-widest text-violet-200/80 mb-1">
              Discovery session {role ? `· ${role}` : ''}
            </p>
            <h1 className="font-display text-2xl font-bold text-violet-50">{projectName || 'New project'}</h1>
          </header>

          {step === 'name' && <ProjectIntake onContinue={handleNameContinue} />}

          {step === 'role' && <RoleSelect onSelect={handleRoleSelect} />}

          {step === 'review-extracted' && role && (
            <ReviewExtracted
              items={extracted.filter((e) => questionsForRole(role, projectName).some((q) => q.id === e.questionId))}
              onConfirm={applyExtractedAnswers}
            />
          )}

          {step === 'bank' && role && (
            <>
              {detectedIndustries.length > 0 && (
                <div className="mb-4 text-xs text-violet-100 bg-violet-500/10 border border-violet-400/30 rounded-xl px-3 py-2">
                  Detected this looks like a <span className="font-medium">{detectedIndustries.join('/')}</span> project
                  — added a few extra questions specific to that.
                </div>
              )}

              {/* Game Progress Bar */}
              <GameProgress
                level={level}
                xp={xp}
                nextLevelXP={levelUpThresholdRef.current}
                streak={streak}
                totalAnswered={answeredIds.length}
              />

              {/* Level Up Animation */}
              {showLevelUp && (
                <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 animate-level-up-pop">
                  <div className="text-6xl">🎉</div>
                  <div className="text-center mt-2 font-display text-2xl font-bold text-signal">
                    Level {level}!
                  </div>
                </div>
              )}

              {/* Sage Guide */}
              {sageMessage && <SageGuide message={sageMessage} expression={sageExpression} show={true} />}

              <div className="bg-violet-950/30 border border-violet-400/30 rounded-2xl p-4 mb-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-violet-200 mb-2">
                      ✓ What we understand
                    </div>
                    {understoodDomains.length === 0 ? (
                      <p className="text-[11px] text-violet-200/60 italic">Nothing confirmed yet</p>
                    ) : (
                      <ul className="space-y-1">
                        {understoodDomains.map((domain) => (
                          <li key={domain} className="text-xs text-violet-100 flex items-center gap-1.5 animate-fade-in">
                            <span className="text-violet-300">●</span> {domain}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-violet-200/80 mb-2">
                      ⚠ Still exploring
                    </div>
                    {exploringDomains.length === 0 ? (
                      <p className="text-[11px] text-violet-200/60 italic">All caught up</p>
                    ) : (
                      <ul className="space-y-1">
                        {exploringDomains.map((domain) => (
                          <li key={domain} className="text-xs text-violet-200/80 flex items-center gap-1.5">
                            <span className="text-amber-200/80">○</span> {domain}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <div className="flex-1">
                  <DiscoveryProgress
                    percent={Math.min(percent, 96)}
                    mood={mood}
                    message={message}
                    answered={answeredIds.length}
                    estimatedTotal={totalEstimate}
                  />
                </div>
              </div>
              {totalEstimate > answeredIds.length && (
                <p className="text-[11px] text-violet-200/70 mb-6">
                  ~{Math.max(1, Math.round(((totalEstimate - answeredIds.length) * 20) / 60))} min left
                </p>
              )}
              {!(totalEstimate > answeredIds.length) && <div className="mb-8" />}

              {retryPrompt && currentQuestion && (
                <div className="mb-4 text-xs text-amber-100 bg-amber-500/10 border border-amber-400/30 rounded-xl px-3 py-2">
                  {retryPrompt}
                </div>
              )}

              {currentQuestion ? (
                <QuestionCard
                  key={currentQuestion.id}
                  domain={currentQuestion.domain}
                  question={currentQuestion.question}
                  options={[...currentQuestion.options, 'Other']}
                  onAnswer={handleBankAnswer}
                  busy={interpreting}
                  category={currentQuestion.category ?? 'gap'}
                  pointsAvailable={10}
                  onPointsEarned={(points) => {
                    // Points animation is handled in QuestionCard
                    // This callback can be used for additional tracking if needed
                  }}
                />
              ) : (
                <div className="bg-violet-950/30 border border-violet-400/30 rounded-2xl p-8 text-center animate-fade-in">
                  <div className="text-3xl mb-3">{submitting ? '⏳' : '🧠'}</div>
                  <p className="text-sm text-violet-100">
                    {submitting ? 'Wrapping up and sending to the consulting team…' : 'Thinking about what else might matter here…'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {screen === 'submitted' && (
        <div className="w-full max-w-xl bg-violet-950/30 border border-violet-400/30 rounded-2xl p-8 animate-fade-in">
          <div className="text-3xl mb-3 text-center">🤩</div>
          <h2 className="font-display text-lg font-semibold text-violet-50 mb-1 text-center">That's everything for now</h2>
          {finalSummary && (
            <p className="text-sm text-violet-100 mt-4 mb-6 leading-relaxed bg-violet-900/20 border border-violet-400/20 rounded-xl p-4">
              {finalSummary}
            </p>
          )}
          <p className="text-sm text-violet-200/80 mb-6 text-center">
            Your answers have been forwarded to your consulting team for review.
          </p>
          <div className="text-center">
            <button onClick={resetToLanding} className="text-sm font-medium text-violet-100 hover:underline">
              Start another session
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
