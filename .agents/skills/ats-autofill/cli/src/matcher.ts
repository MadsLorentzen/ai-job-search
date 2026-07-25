// Field matching for job application forms.
//
// Pure functions only, no browser. Everything here is unit-testable offline,
// which matters because the failure mode we care about is answering a question
// WRONG (e.g. saying you need visa sponsorship when you don't), not failing to
// answer it. An unanswered field is a minor inconvenience; a wrongly answered
// legal attestation is a real problem.
//
// Guiding rule: when confidence is low, return null. The CLI reports every
// unfilled field so the human fills it in before submitting.

export interface Identity {
  firstName: string
  lastName: string
  preferredName?: string | null
  email: string
  phone: string
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
}

export interface Links {
  linkedin?: string | null
  github?: string | null
  portfolio?: string | null
  other?: string | null
}

export interface WorkAuthorization {
  /** Legally authorized to work in the US without sponsorship. */
  authorizedUS: boolean
  /** Will now or in the future require sponsorship. */
  requiresSponsorship: boolean
  citizenshipStatus?: string | null
  activeClearance?: string | null
  clearanceEligible?: boolean | null
}

export interface Eeo {
  gender?: string | null
  race?: string | null
  veteranStatus?: string | null
  disabilityStatus?: string | null
  hispanicLatino?: string | null
}

export interface Preferences {
  remotePreference?: string | null
  willingToRelocate?: boolean | null
  noticePeriod?: string | null
  earliestStartDate?: string | null
  /** Left null on purpose: never volunteer a compensation number. */
  desiredSalary?: string | null
  currentSalary?: string | null
}

export interface Profile {
  identity: Identity
  links: Links
  workAuthorization: WorkAuthorization
  eeo: Eeo
  preferences: Preferences
  documents: { resume?: string | null; coverLetter?: string | null }
  answers: Record<string, string>
}

export type FieldValue =
  | { kind: "text"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "choice"; value: string }
  | { kind: "file"; value: string }

export interface MatchResult {
  key: string
  value: FieldValue
  /** high = deterministic identity/auth mapping. low = heuristic, worth eyeballing. */
  confidence: "high" | "low"
}

/**
 * Normalize a form label for matching: lowercase, strip the required-marker
 * asterisk, collapse punctuation and whitespace.
 */
export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'+/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** True when the label asks about needing sponsorship (answer: requiresSponsorship). */
function isSponsorshipQuestion(label: string): boolean {
  const mentionsSponsorship =
    /\bsponsor(ship|ing|ed)?\b/.test(label) ||
    /\bh-?1-?b\b/.test(label) ||
    /\bvisa\b/.test(label) ||
    /\bwork permit\b/.test(label)
  if (!mentionsSponsorship) return false
  // "authorized to work" phrasing is handled separately and takes precedence,
  // unless it is the compound "authorized ... without sponsorship" form.
  return true
}

/**
 * True when the label asks whether you are authorized to work (answer: authorizedUS).
 * Deliberately excludes the sponsorship phrasing, which inverts the answer.
 */
function isAuthorizationQuestion(label: string): boolean {
  return (
    /\b(legally\s+)?authorized\b/.test(label) ||
    /\beligible to work\b/.test(label) ||
    /\blegally (able|permitted) to work\b/.test(label) ||
    /\bright to work\b/.test(label)
  )
}

/**
 * Sponsorship questions come in both polarities and the wrong answer is
 * disqualifying, so resolve them explicitly rather than with a generic rule.
 *
 *   "Will you now or in the future require sponsorship?"  -> requiresSponsorship
 *   "Are you authorized to work without sponsorship?"     -> !requiresSponsorship
 */
export function resolveSponsorship(label: string, auth: WorkAuthorization): boolean | null {
  const l = normalizeLabel(label)
  if (!isSponsorshipQuestion(l) && !isAuthorizationQuestion(l)) return null

  const withoutSponsorship = /\bwithout (requiring |needing )?(visa )?sponsorship\b/.test(l)
  const doNotRequire = /\bdo not require\b/.test(l) || /\bnot require\b/.test(l)

  if (isAuthorizationQuestion(l)) {
    // "authorized to work ... without sponsorship" is still an authorization
    // question; the "without sponsorship" clause does not flip it.
    if (withoutSponsorship) return auth.authorizedUS && !auth.requiresSponsorship
    return auth.authorizedUS
  }

  // Pure sponsorship question.
  if (withoutSponsorship || doNotRequire) return !auth.requiresSponsorship
  if (/\b(require|need|request|seek)\b/.test(l)) return auth.requiresSponsorship
  // Mentions sponsorship but in a shape we do not recognize. Do not guess.
  return null
}

interface Rule {
  key: string
  test: RegExp
  /** Rules are evaluated in array order; first match wins. */
  resolve: (p: Profile) => FieldValue | null
  confidence?: "high" | "low"
}

/**
 * Unfilled-template markers must never reach a real application form. Typing
 * "CONFIRM" into a recruiter's LinkedIn field is worse than leaving it blank,
 * so treat these exactly like missing data.
 */
export function isPlaceholder(v: string): boolean {
  return /^(confirm|tbd|todo|xxx+|fill ?me|your[_ ].+|\[.*\])$/i.test(v.trim())
}

const usable = (v: string | null | undefined): string | null =>
  v == null || v.trim() === "" || isPlaceholder(v) ? null : v

const text = (v: string | null | undefined): FieldValue | null => {
  const u = usable(v)
  return u === null ? null : { kind: "text", value: u }
}

const choice = (v: string | null | undefined): FieldValue | null => {
  const u = usable(v)
  return u === null ? null : { kind: "choice", value: u }
}

const file = (v: string | null | undefined): FieldValue | null => {
  const u = usable(v)
  return u === null ? null : { kind: "file", value: u }
}

/**
 * Ordered rules. Specific patterns must precede general ones: "first name"
 * before "name", "linkedin profile" before "profile".
 */
const RULES: Rule[] = [
  // --- Documents (checked first: "resume" appears inside other labels) ---
  { key: "resume", test: /\b(resume|cv|curriculum vitae)\b/, resolve: (p) => file(p.documents.resume) },
  { key: "coverLetter", test: /\bcover letter\b/, resolve: (p) => file(p.documents.coverLetter) },

  // --- Links (before generic name/text rules) ---
  { key: "linkedin", test: /\blinked ?in\b/, resolve: (p) => text(p.links.linkedin) },
  { key: "github", test: /\b(git ?hub|gitlab)\b/, resolve: (p) => text(p.links.github) },
  {
    key: "portfolio",
    test: /\b(portfolio|personal (web)?site|website|blog|homepage)\b/,
    resolve: (p) => text(p.links.portfolio),
  },

  // --- Identity ---
  { key: "firstName", test: /\b(first|given|fore)\s?name\b/, resolve: (p) => text(p.identity.firstName) },
  { key: "lastName", test: /\b(last|family|sur)\s?name\b/, resolve: (p) => text(p.identity.lastName) },
  {
    key: "preferredName",
    test: /\b(preferred|nick)\s?name\b/,
    resolve: (p) => text(p.identity.preferredName ?? p.identity.firstName),
  },
  {
    key: "fullName",
    test: /\b(full name|your name|legal name|name)\b/,
    resolve: (p) => text(`${p.identity.firstName} ${p.identity.lastName}`),
  },
  { key: "email", test: /\be-?mail\b/, resolve: (p) => text(p.identity.email) },
  { key: "phone", test: /\b(phone|mobile|cell|telephone)\b/, resolve: (p) => text(p.identity.phone) },

  // --- Address ---
  { key: "postalCode", test: /\b(zip|postal)\s?code\b/, resolve: (p) => text(p.identity.postalCode) },
  { key: "state", test: /\b(state|province|region)\b/, resolve: (p) => text(p.identity.state) },
  { key: "country", test: /\bcountry\b/, resolve: (p) => text(p.identity.country) },
  { key: "city", test: /\b(city|town|locality)\b/, resolve: (p) => text(p.identity.city) },
  {
    key: "location",
    test: /\b(location|address|where are you (currently )?(located|based))\b/,
    resolve: (p) => {
      const parts = [p.identity.city, p.identity.state, p.identity.country].filter(Boolean)
      return parts.length ? { kind: "text", value: parts.join(", ") } : null
    },
  },

  // --- Compensation: intentionally never auto-filled ---
  {
    key: "desiredSalary",
    test: /\b(desired|expected|target)\b.*\b(salary|compensation|pay|rate)\b|\b(salary|compensation)\s+(expectation|requirement)/,
    resolve: (p) => text(p.preferences.desiredSalary),
    confidence: "low",
  },
  {
    key: "currentSalary",
    test: /\bcurrent\b.*\b(salary|compensation|pay)\b/,
    resolve: (p) => text(p.preferences.currentSalary),
    confidence: "low",
  },

  // --- Availability ---
  {
    key: "earliestStartDate",
    test: /\b(start date|available to start|availability|when can you start|earliest)\b/,
    resolve: (p) => text(p.preferences.earliestStartDate),
    confidence: "low",
  },
  {
    key: "noticePeriod",
    test: /\bnotice period\b/,
    resolve: (p) => text(p.preferences.noticePeriod),
    confidence: "low",
  },
  {
    key: "willingToRelocate",
    test: /\b(relocat\w*)\b/,
    resolve: (p) =>
      p.preferences.willingToRelocate == null
        ? null
        : { kind: "boolean", value: p.preferences.willingToRelocate },
    confidence: "low",
  },
  {
    key: "remotePreference",
    test: /\b(remote|hybrid|on-?site|work arrangement)\b/,
    resolve: (p) => text(p.preferences.remotePreference),
    confidence: "low",
  },

  // --- Clearance ---
  {
    key: "clearance",
    test: /\b(security clearance|clearance level|active clearance)\b/,
    resolve: (p) => text(p.workAuthorization.activeClearance),
    confidence: "low",
  },

  // --- EEO / self-identification ---
  { key: "hispanicLatino", test: /\bhispanic|latino\b/, resolve: (p) => choice(p.eeo.hispanicLatino) },
  { key: "gender", test: /\b(gender|sex)\b/, resolve: (p) => choice(p.eeo.gender) },
  { key: "race", test: /\b(race|ethnicity|ethnic)\b/, resolve: (p) => choice(p.eeo.race) },
  { key: "veteranStatus", test: /\bveteran\b/, resolve: (p) => choice(p.eeo.veteranStatus) },
  {
    key: "disabilityStatus",
    test: /\bdisabilit(y|ies)\b/,
    resolve: (p) => choice(p.eeo.disabilityStatus),
  },
]

/**
 * Match a form label to a profile value.
 *
 * Returns null when nothing matches confidently. Callers must surface those
 * labels to the user rather than filling something plausible.
 */
export function matchField(rawLabel: string, profile: Profile): MatchResult | null {
  const label = normalizeLabel(rawLabel)
  if (!label) return null

  // Work authorization and sponsorship first: these invert, and a generic rule
  // would answer them backwards.
  const sponsorship = resolveSponsorship(label, profile.workAuthorization)
  if (sponsorship !== null) {
    const key = isAuthorizationQuestion(label) ? "workAuthorized" : "requiresSponsorship"
    return { key, value: { kind: "boolean", value: sponsorship }, confidence: "high" }
  }

  // Free-text answers keyed by the user in application_profile.json.
  // Underscore-prefixed keys are file comments, not answers.
  for (const [key, answer] of Object.entries(profile.answers)) {
    if (key.startsWith("_") || typeof answer !== "string" || isPlaceholder(answer)) continue
    const needle = normalizeLabel(key)
    if (needle && label.includes(needle)) {
      return { key: `answers.${key}`, value: { kind: "text", value: answer }, confidence: "low" }
    }
  }

  for (const rule of RULES) {
    if (!rule.test.test(label)) continue
    const value = rule.resolve(profile)
    if (value === null) return null // matched the concept, but we have no data
    return { key: rule.key, value, confidence: rule.confidence ?? "high" }
  }

  return null
}

/**
 * Pick the option from a select/radio group that best represents `value`.
 * Returns null when no option is a defensible match.
 */
export function matchOption(value: FieldValue, options: string[]): string | null {
  if (!options.length) return null
  const norm = options.map((o) => ({ raw: o, n: normalizeLabel(o) }))

  if (value.kind === "boolean") {
    const wanted = value.value ? /^(yes|true|y)\b/ : /^(no|false|n)\b/
    const hit = norm.find((o) => wanted.test(o.n))
    return hit ? hit.raw : null
  }

  const target = normalizeLabel(value.value)
  if (!target) return null

  const exact = norm.find((o) => o.n === target)
  if (exact) return exact.raw

  // "Decline to self identify" has many spellings across ATS vendors.
  if (/decline|prefer not|prefer to not|do(n'?t| not) wish|not to answer|choose not|opt out/.test(target)) {
    const decline = norm.find((o) => /decline|prefer not|prefer to not|do(n'?t| not) wish|not to answer|choose not|opt out/.test(o.n))
    if (decline) return decline.raw
  }

  const contains = norm.find((o) => o.n.includes(target) || target.includes(o.n))
  return contains ? contains.raw : null
}
