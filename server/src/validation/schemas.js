import { z } from 'zod';
import { APPLICATION_STATUSES, SEEN_STATES } from '../services/storageService.js';
import { DOC_TYPES, APP_ID_PATTERN } from '../services/latexService.js';

/**
 * Request schemas.
 *
 * Every body and query is parsed through one of these. Zod strips unknown keys
 * by default, which is what closes the class of bug where the tracker
 * persisted whatever object it was handed (including a `cvPdfPath` pointing at
 * any file on disk). Previously that was a hand-maintained field whitelist
 * that each new endpoint had to remember to apply.
 */

export const uuid = z.string().regex(APP_ID_PATTERN, 'Expected a UUID.');

const trimmed = (max = 500) => z.string().trim().max(max);

export const docType = z.enum(DOC_TYPES);

export const jobSchema = z.object({
  title: trimmed(300).min(1, 'Job title is required.'),
  company: trimmed(300).default(''),
  location: trimmed(300).default(''),
  url: z.union([z.string().url(), z.literal('')]).default(''),
  description: z.string().max(200_000).default(''),
  id: trimmed(200).optional(),
  portal: trimmed(100).optional()
});

const jobWithDescription = jobSchema.refine(
  (job) => job.description.trim().length >= 30,
  { message: 'A job description of at least 30 characters is required.', path: ['description'] }
);

export const evaluateBody = z.object({ job: jobWithDescription });

export const interviewBody = z.object({ job: jobSchema });

export const generateBody = z.object({
  job: jobWithDescription,
  fitEvaluation: z.record(z.string(), z.unknown()).nullish()
});

export const compileBody = z.object({
  type: docType.default('cv'),
  latexContent: z.string().min(1, 'LaTeX content is required.').max(500_000),
  appId: uuid.nullish()
});

/** Client-writable application fields. Server-owned columns are absent. */
export const applicationBody = z.object({
  id: uuid,
  jobTitle: trimmed(300).optional(),
  company: trimmed(300).optional(),
  location: trimmed(300).optional(),
  jobUrl: z.union([z.string().url(), z.literal('')]).optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  fitScore: z.number().int().min(0).max(100).nullish(),
  reviewScore: z.number().int().min(0).max(100).nullish(),
  cvLatex: z.string().max(500_000).nullish(),
  coverLetterLatex: z.string().max(500_000).nullish(),
  auditsPassed: z.array(z.string().max(500)).max(50).optional(),
  revisionsApplied: z.array(z.string().max(500)).max(50).optional(),
  notes: z.string().max(20_000).optional(),
  followUpAt: z.union([z.string().datetime(), z.literal('')]).nullish(),
  source: trimmed(50).nullish(),
  appliedAt: z.string().datetime().nullish()
});

export const statusBody = z.object({
  status: z.enum(APPLICATION_STATUSES, {
    message: `Expected one of: ${APPLICATION_STATUSES.join(', ')}.`
  })
});

export const trackerQuery = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  search: trimmed(200).optional(),
  followUpBefore: z.string().datetime().optional()
});

export const searchQuery = z.object({
  query: trimmed(200).default(''),
  location: trimmed(200).default('Remote'),
  portal: trimmed(100).default('freehire-search'),
  remote: trimmed(50).default('all'),
  hideSeen: z.enum(['true', 'false']).default('false')
});

export const detailQuery = z.object({
  portal: trimmed(100),
  url: z.string().url('A job URL is required.'),
  id: trimmed(200).optional()
});

export const jobStateBody = z.object({
  state: z.enum(SEEN_STATES, { message: `Expected one of: ${SEEN_STATES.join(', ')}.` })
});

export const loginBody = z.object({
  password: z.string().min(1, 'Password is required.').max(500)
});

export const uploadCvBody = z.object({
  rawText: z.string().max(500_000).optional()
});

/** Profile is deliberately permissive: it is user content, not a command. */
export const profileBody = z.object({
  identity: z.object({
    name: trimmed(200).default(''),
    title: trimmed(200).default(''),
    email: z.union([z.string().email(), z.literal('')]).default(''),
    phone: trimmed(60).default(''),
    location: trimmed(200).default(''),
    linkedin: trimmed(300).default(''),
    github: trimmed(300).default(''),
    portfolio: trimmed(300).default(''),
    summary: z.string().max(5000).default(''),
    status: trimmed(100).default('Actively Looking'),
    languages: z.array(z.object({
      language: trimmed(100).default(''),
      level: trimmed(100).default('')
    })).max(30).default([])
  }).prefault({}),
  education: z.array(z.object({
    degree: trimmed(300).default(''),
    institution: trimmed(300).default(''),
    period: trimmed(100).default(''),
    thesis: trimmed(500).default(''),
    highlights: z.string().max(2000).default('')
  })).max(30).default([]),
  experience: z.array(z.object({
    title: trimmed(300).default(''),
    company: trimmed(300).default(''),
    location: trimmed(200).default(''),
    period: trimmed(100).default(''),
    bullets: z.array(z.string().max(1000)).max(30).default([])
  })).max(50).default([]),
  skills: z.object({
    primary: z.array(trimmed(120)).max(100).default([]),
    secondary: z.array(trimmed(120)).max(100).default([]),
    domain: z.array(trimmed(120)).max(100).default([]),
    tools: z.array(trimmed(120)).max(100).default([])
  }).prefault({}),
  starStories: z.array(z.object({
    id: trimmed(100).default(''),
    title: trimmed(300).default(''),
    situation: z.string().max(3000).default(''),
    task: z.string().max(3000).default(''),
    action: z.string().max(3000).default(''),
    result: z.string().max(3000).default('')
  })).max(30).default([]),
  targetQueries: z.array(z.object({
    query: trimmed(200).default(''),
    location: trimmed(200).default(''),
    portal: trimmed(100).default('')
  })).max(30).default([]),
  salary: z.object({
    minimum: trimmed(100).default(''),
    target: trimmed(100).default(''),
    currency: trimmed(20).default('')
  }).prefault({}),
  onboardingComplete: z.boolean().default(false)
});
