/**
 * A practice posting for an empty Jobs tab. Marked fake so Claude will not
 * treat it as a live employer. First-timers can run Apply against it and
 * see a CV appear without hunting a real URL.
 */
export const SAMPLE_JOB = {
  key: "sample:practice",
  title: "Staff Software Engineer",
  company: "Northstar Practice Labs",
  location: "Remote, United States",
  url: "",
  firstSeen: "",
  postedDate: null,
  deadline: null,
  fit: "",
  scraperStatus: "new",
  rankScore: null,
  rankVerdict: "",
  strengths: [],
  gaps: [],
  portal: "",
  mark: null,
  bucket: "new",
  applicationStatus: "",
  sample: true,
};

export const SAMPLE_POSTING = `# Staff Software Engineer - Northstar Practice Labs

PRACTICE POSTING. This is not a real employer. Do not look up a company
page. Do not invent partnerships or products. Treat the requirements
below as the whole brief.

- Location: Remote, United States (hybrid in the same metro OK)
- Type: Full-time, Staff IC
- Salary: $160,000-$190,000
- Posted: today

## About the role

Build and ship production RAG and agentic systems for an operations
team. You own the retrieval pipeline, evaluation, and the
human-in-the-loop review path. Python is the working language.

## What you will do

- Design and maintain a RAG service over internal documents
- Add evaluation and logging so a non-engineer can see why an answer was given
- Keep a human in the loop for anything that reaches a customer or a regulator

## Requirements

- Production Python experience with LLMs, RAG, or agent workflows
- Comfortable writing evaluation harnesses, not only prompts
- Able to explain a system to a non-engineering partner
- Based in the United States; cannot relocate for this practice role

## Nice to have

- Privacy-first or on-device inference
- Claude Code or similar agentic coding tools used in real delivery
`;

export function attachSample(board) {
  const empty = !board || !board.jobs || board.jobs.length === 0;
  return {
    ...board,
    sample: empty ? { ...SAMPLE_JOB } : null,
    samplePosting: SAMPLE_POSTING,
  };
}
