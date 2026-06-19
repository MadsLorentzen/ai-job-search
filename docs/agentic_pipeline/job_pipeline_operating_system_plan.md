# Job Pipeline Operating System Plan

This plan extends the application-assistant workflow into a constrained operating system for job-search pipeline management. The goal is not maximum application volume. The goal is qualified movement through a clean state machine with evidence, suppression rules, and human approval before state-changing actions.

## Design Principle

The job pipeline is not a scraper plus an LLM. It is a governed workflow:

- preserve source evidence
- keep every opportunity in exactly one stage
- protect live conversations before creating new application volume
- suppress low-quality or risky opportunities
- require approval before sending, submitting, attaching, or accepting terms
- make the next action obvious every day

## Public-Safe Boundary

This repository should not contain private pipeline state.

Do not commit:

- credentials
- mailbox exports
- OAuth tokens
- browser profiles
- resumes or private application packets
- private contact lists
- compensation history
- identity documents
- right-to-represent forms
- private recruiter or employer correspondence

Keep private operational state in a separate private database, spreadsheet, CRM, or private repo.

## System Of Record

Create the system of record before adding automation. A spreadsheet, SQLite database, Airtable, CRM, or Markdown-backed private repo can work. The storage engine matters less than the invariants.

Minimum entities:

- Company
- Role
- Contact
- Source
- Application
- Conversation
- Touch
- Decision
- Artifact

Minimum opportunity fields:

- company
- role title
- source
- contact or sender
- stage
- work model
- compensation or rate
- remote, hybrid, onsite, travel, and timezone constraints
- authorization and sponsorship assumptions
- client or hiring group
- right-to-represent, exclusivity, and duplicate-submission risk
- evidence path or message ID
- last touch
- next action
- next action date
- suppression reason if held

## Stage Model

Every opportunity must be in exactly one stage:

1. `discovered`
2. `qualified`
3. `suppressed`
4. `applied`
5. `recruiter-screen`
6. `submitted-to-client`
7. `interviewing`
8. `offer-intent`
9. `offer-received`
10. `accepted`
11. `rejected-or-closed`

Do not use vague stages such as `interesting`, `maybe`, `watch`, or `follow-up someday`. If an item is missing information, its next action is an information request. If it violates a hard constraint, it is suppressed with a reason.

## Daily Operating Loop

Run this loop before any broad application volume:

1. Check approved inboxes and message surfaces.
2. Classify inbound items as `actionable`, `FYI`, `suppressed`, or `unrelated`.
3. Handle live recruiter, hiring-manager, referral, interview, offer, or client movement first.
4. Update the system of record after each reply, call, screen, interview, application, rejection, or offer signal.
5. Draft follow-ups only after classification and cadence checks.
6. Hold all state-changing actions for human approval unless a narrow class has been explicitly delegated.
7. Only after active response handling is current, consider new sourcing or application volume.
8. Produce a daily rollup.

## Qualification Gates

Before a recruiter call, submission, right-to-represent discussion, or meaningful time investment, capture:

- actual company or end client
- role title and scope
- W2, 1099, C2C, direct-hire, or subcontract model
- compensation or rate range
- remote, hybrid, onsite, travel, and timezone expectations
- contract length and conversion possibility
- interview process and timeline
- right-to-represent, exclusivity, and duplicate-submission terms
- work authorization and sponsorship assumptions

If a gate is missing, the default next action is a clarifying request.

## Human Approval Gates

Require explicit approval before:

- sending an external message
- submitting an application
- attaching or transmitting a resume, portfolio, work sample, or private document
- accepting right-to-represent, exclusivity, background-check, offer, or start-date terms
- stating or changing compensation, location, travel, authorization, sponsorship, or availability posture
- contacting an active client or sensitive relationship
- submitting to a company or role with unresolved duplicate risk

## Scoring Rubric

Score each factor 1 to 5 and preserve a short rationale:

| Factor | Question |
|---|---|
| Technical fit | Does the role match actual skills and experience? |
| Compensation or rate | Does it meet the economic threshold? |
| Remote feasibility | Does the location model work? |
| Decision-maker proximity | Is there a real person or only a generic ATS? |
| Process clarity | Are the steps, timeline, and owner clear? |
| Duplicate risk | Could another recruiter/application already cover this role? |
| Time cost | Is the assessment/application burden worth it? |
| Conversion evidence | Is there evidence this can move to screen, interview, or offer? |

The score is not the decision. It is a forcing function for explainable prioritization.

## Suppression Rules

Suppress or defer when:

- the company, end client, or hiring group is unknown
- the role violates compensation, location, authorization, sponsorship, or travel constraints
- the recruiter requests right-to-represent before confirming the role, client, rate, and model
- the same role or company may already have an active submission
- the contact path is generic or not credible
- the message requests sensitive identity data too early
- the process requires upfront payment, fake-check equipment purchase, crypto/gift-card transfer, or off-platform-only chat
- the opportunity would displace a higher-conversion live thread

## Follow-Up Cadence

Default cadence:

- Same day: scheduling, interview logistics, hot recruiter or hiring-manager movement, corrections.
- 2 to 3 business days: active recruiter or hiring-manager thread with no response.
- 5 to 7 business days: application follow-up where a real person exists.
- No follow-up: generic ATS acknowledgements, no named contact, low-fit roles, or threads where the next action belongs to the candidate.

Every follow-up should clarify terms, advance scheduling, add differentiated evidence, or close a loop. If it does none of those, hold it.

## Agent Roles

Separate duties to reduce drift:

- Inbox triage agent: classify inbound items and extract metadata.
- Pipeline operator: update system of record and select next action.
- Role-fit analyst: score role/company fit and flag missing gates.
- Follow-up drafter: draft concise replies under follow-up rules.
- Guardrail reviewer: check overclaiming, duplicate risk, right-to-represent risk, scam risk, and lane confusion.
- Human approver: send, reject, or revise state-changing actions.

Do not let one autonomous agent own discovery, drafting, sending, and state updates without review.

## Reporting

At the end of each operating cycle, produce:

- new actionable items
- replies drafted
- replies approved/sent
- applications submitted
- screens, interviews, or offers advanced
- items suppressed and why
- waiting items
- blocked items
- first next action for tomorrow

Track stage conversion:

`discovered -> qualified -> applied -> recruiter-screen -> submitted-to-client -> interviewing -> offer-received -> accepted`

Also track how many items were suppressed before wasting time.

## Implementation Order

1. Create the private system-of-record table or database.
2. Define personal constraints: target role families, minimum compensation/rate, remote posture, geography, sponsorship, travel, and deal-breakers.
3. Add process skills for pipeline operation and lead-touch follow-up.
4. Build inbox triage that only classifies and recommends.
5. Build follow-up drafting that never sends without approval.
6. Add duplicate suppression for company, role, recruiter, job ID, and source URL.
7. Add daily rollup reporting.
8. Only after those controls work, add sourcing or application automation.

