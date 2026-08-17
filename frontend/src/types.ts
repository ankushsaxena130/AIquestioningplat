export type Role =
  | 'Business Owner'
  | 'Product Manager'
  | 'Technical Lead'
  | 'Data/AI Lead'
  | 'Security/Compliance'
  | 'IT/Infrastructure'

export interface QuestionDef {
  id: string
  domain: string
  roles: Role[]
  question: string
  options: string[]       // MCQ choices; "Other" is appended automatically
  mandatory: boolean
  dependsOn?: string      // question id that must be answered first
}

export interface AnswerRecord {
  questionId: string
  domain: string
  question: string
  answer: string
}

export interface ExtractedAnswer {
  questionId: string
  domain: string
  question: string
  answer: string
  confidence: number
}

export type Screen =
  | 'landing'
  | 'questions'      // covers: project name -> role -> role-based questions, in one continuous flow
  | 'submitted'
  | 'consultant'

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
