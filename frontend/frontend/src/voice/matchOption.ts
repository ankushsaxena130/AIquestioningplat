function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Matches what the user said against the list of MCQ options for the
 * current question. Tries, in order: exact match, substring match either
 * direction, then word-overlap scoring — so "azure" matches "Yes - Azure
 * AD" without the user needing to say the option verbatim.
 * Returns null if nothing matches confidently enough.
 */
export function matchSpokenOption(transcript: string, options: string[]): string | null {
  const heard = normalize(transcript)
  if (!heard) return null

  for (const opt of options) {
    if (normalize(opt) === heard) return opt
  }
  for (const opt of options) {
    const optNorm = normalize(opt)
    if (optNorm.length > 0 && (heard.includes(optNorm) || optNorm.includes(heard))) return opt
  }

  const heardTokens = new Set(heard.split(' ').filter(Boolean))
  let best: { opt: string; score: number } | null = null
  for (const opt of options) {
    const optTokens = normalize(opt).split(' ').filter(Boolean)
    if (optTokens.length === 0) continue
    const overlap = optTokens.filter((t) => heardTokens.has(t)).length
    const score = overlap / optTokens.length
    if (score > 0 && (!best || score > best.score)) best = { opt, score }
  }
  // Require at least half the option's words to have been heard —
  // permissive enough for natural speech, strict enough to avoid
  // guessing wrong on a near-miss.
  return best && best.score >= 0.5 ? best.opt : null
}

const YES_WORDS = new Set(['yes', 'yeah', 'yep', 'yup', 'correct', 'right', 'sure', 'confirm', 'confirmed', 'ok', 'okay'])
const NO_WORDS = new Set(['no', 'nope', 'nah', 'wrong', 'incorrect', 'negative'])

export function matchYesNo(transcript: string): 'yes' | 'no' | null {
  const tokens = normalize(transcript).split(' ').filter(Boolean)
  if (tokens.some((t) => YES_WORDS.has(t))) return 'yes'
  if (tokens.some((t) => NO_WORDS.has(t))) return 'no'
  return null
}
