export type Role =
  | 'Business Owner'
  | 'Product Manager'
  | 'Technical Lead'
  | 'Data/AI Lead'
  | 'Security/Compliance'
  | 'IT/Infrastructure'

// 'gap' = closing a requirements/discovery gap (the original behavior).
// 'ideation' = a proactive "how do we make this better" question — the
// kind a good consultant (or Claude) would volunteer even if nothing
// forced them to: what goes on the homepage, what would make this stand
// out, what's the one feature users would love. Defaults to 'gap' when
// absent so every pre-existing question definition still works unchanged.
export type QuestionCategory = 'gap' | 'ideation'

export interface QuestionDef {
  id: string
  domain: string
  roles: Role[]
  question: string
  options: string[]       // MCQ choices; "Other" is appended automatically
  mandatory: boolean
  dependsOn?: string      // question id that must be answered first
  category?: QuestionCategory
}

export interface AnswerRecord {
  questionId: string
  domain: string
  question: string
  answer: string
  category?: QuestionCategory
}

export interface ExtractedAnswer {
  questionId: string
  domain: string
  question: string
  answer: string
  confidence: number
  category?: QuestionCategory
}

export type Screen =
  | 'landing'
  | 'login'           // shared login/registration screen for both client and consultant (see authPath)
  | 'questions'      // covers: project name -> role -> role-based questions, in one continuous flow
  | 'submitted'
  | 'consultant'

export interface AuthUser {
  id: string
  email: string
  role: 'client' | 'consultant' | 'admin'
}

export interface ProjectSummary {
  id: string
  name: string
  role: string
  readiness: number
  answered: number
  total: number
  createdAt: string
}

export interface ProjectFull extends ProjectSummary {
  answers: AnswerRecord[]
}

export interface GapPrediction {
  domain: string
  gapProbability: number
  criticality: number
  method?: string
}

export interface SimilarProject {
  id: string
  name: string
  role: string
  similarity: number
}

export interface FeedbackRecord {
  id: string
  targetType: string
  targetId: string
  action: string
  modelScore?: number
  note?: string
}

export interface Contradiction {
  id: string
  domainA: string
  questionA: string
  answerA: string
  domainB: string
  questionB: string
  answerB: string
  explanation: string
}
