import React, { useEffect, useMemo, useRef, useState } from 'react'
import DiscoveryProgress, { ProgressMood } from './components/DiscoveryProgress'
import QuestionCard from './components/QuestionCard'
import ProjectIntake from './components/ProjectIntake'
import ReviewExtracted from './components/ReviewExtracted'
import RoleSelect from './components/RoleSelect'
import LandingScreen from './components/LandingScreen'
import ConsultantDashboard from './components/ConsultantDashboard'
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
            mandatory: true
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

  function handleNameContinue(name: string, extractedAnswers: ExtractedAnswer[]) {
    setProjectName(name)
    setExtracted(extractedAnswers)
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
        { questionId: currentQuestion.id, domain: currentQuestion.domain, question: currentQuestion.question, answer: finalAnswer }
      ])
      const nextPercent = Math.round((nextAnswered.length / Math.max(totalEstimate, nextAnswered.length)) * 100)
      setMood('confident')
      setPercent(nextPercent)
      checkMilestone(nextPercent)
      setMessage(CONFIDENT_MESSAGES[Math.min(nextAnswered.length - 1, CONFIDENT_MESSAGES.length - 1)])
      setRetryPrompt(null)
      setDynamicQuestion(null)
    } else {
      setMood('thinking')
      setMessage(THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)])
      setRetryPrompt('Could you rephrase that with a bit more detail? For example: a rough number, a name, or a yes/no.')
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
          answers: answers.map((a) => ({ domain: a.domain, question: a.question, answer: a.answer }))
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
          summary
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
    <div className="min-h-screen bg-paper flex items-start justify-center py-16 px-4">
      {milestoneMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-ink text-paper text-sm font-medium px-5 py-2.5 rounded-full shadow-lg animate-fade-in">
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
            <p className="font-mono text-xs uppercase tracking-widest text-ink/50 mb-1">
              Discovery session {role ? `· ${role}` : ''}
            </p>
            <h1 className="font-display text-2xl font-bold text-ink">{projectName || 'New project'}</h1>
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
                <div className="mb-4 text-xs text-signal bg-signal/10 border border-signal/30 rounded-xl px-3 py-2">
                  Detected this looks like a <span className="font-medium">{detectedIndustries.join('/')}</span> project
                  — added a few extra questions specific to that.
                </div>
              )}

              <div className="bg-white border border-line rounded-2xl p-4 mb-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-signal mb-2">
                      ✓ What we understand
                    </div>
                    {understoodDomains.length === 0 ? (
                      <p className="text-[11px] text-ink/30 italic">Nothing confirmed yet</p>
                    ) : (
                      <ul className="space-y-1">
                        {understoodDomains.map((domain) => (
                          <li key={domain} className="text-xs text-ink/70 flex items-center gap-1.5 animate-fade-in">
                            <span className="text-signal">●</span> {domain}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-ink/40 mb-2">
                      ⚠ Still exploring
                    </div>
                    {exploringDomains.length === 0 ? (
                      <p className="text-[11px] text-ink/30 italic">All caught up</p>
                    ) : (
                      <ul className="space-y-1">
                        {exploringDomains.map((domain) => (
                          <li key={domain} className="text-xs text-ink/40 flex items-center gap-1.5">
                            <span className="text-amber/60">○</span> {domain}
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
                <p className="text-[11px] text-ink/35 mb-6">
                  ~{Math.max(1, Math.round(((totalEstimate - answeredIds.length) * 20) / 60))} min left
                </p>
              )}
              {!(totalEstimate > answeredIds.length) && <div className="mb-8" />}

              {retryPrompt && currentQuestion && (
                <div className="mb-4 text-xs text-amber bg-amber/10 border border-amber/30 rounded-xl px-3 py-2">
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
                />
              ) : (
                <div className="bg-white border border-line rounded-2xl p-8 text-center animate-fade-in">
                  <div className="text-3xl mb-3">{submitting ? '⏳' : '🧠'}</div>
                  <p className="text-sm text-ink/60">
                    {submitting ? 'Wrapping up and sending to the consulting team…' : 'Thinking about what else might matter here…'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {screen === 'submitted' && (
        <div className="w-full max-w-xl bg-white border border-line rounded-2xl p-8 animate-fade-in">
          <div className="text-3xl mb-3 text-center">🤩</div>
          <h2 className="font-display text-lg font-semibold text-ink mb-1 text-center">That's everything for now</h2>
          {finalSummary && (
            <p className="text-sm text-ink/70 mt-4 mb-6 leading-relaxed bg-paper border border-line rounded-xl p-4">
              {finalSummary}
            </p>
          )}
          <p className="text-sm text-ink/60 mb-6 text-center">
            Your answers have been forwarded to your consulting team for review.
          </p>
          <div className="text-center">
            <button onClick={resetToLanding} className="text-sm font-medium text-signal hover:underline">
              Start another session
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
