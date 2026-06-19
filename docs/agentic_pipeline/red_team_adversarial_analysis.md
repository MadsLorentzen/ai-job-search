# Red-Team Adversarial Analysis: Job Pipeline Agent Program

This analysis assumes the pipeline will fail in the most common ways: over-automation, recruiter pressure, private-data leakage, duplicate submissions, fake opportunities, stale state, and relationship damage.

## Threat Model

### Assets To Protect

- candidate reputation
- private identity and employment documents
- active recruiter and hiring-manager relationships
- application credibility
- compensation and availability posture
- right-to-represent and exclusivity position
- private correspondence and contact lists
- clean evidence trail

### Adversaries And Failure Sources

- high-volume recruiters seeking fast right-to-represent authorization
- fake recruiters seeking identity information or money
- low-quality automation generating duplicate or generic touches
- ATS and VMS systems that penalize duplicate submissions
- internal agent drift that creates activity without conversion
- stale state that makes the next action wrong
- relationship confusion between job-search, consulting, client-development, and personal lanes

## Attack Scenarios And Controls

### 1. Duplicate Submission Trap

**Scenario:** Two recruiters pitch the same end client and role. The pipeline allows both conversations to proceed because the titles differ slightly.

**Impact:** Candidate may be rejected or deprioritized because the client does not want an agency dispute.

**Controls:**

- require end client or hiring group before submission
- match company, client, role title, job ID, recruiter, source URL, and job-description fingerprint
- hold all duplicate-risk submissions for human approval
- require a "prior submission disclosure" field when a role resembles an earlier opportunity

**Enhancement:** Add a duplicate-risk score and require `duplicate-risk: clear` before `submitted-to-client`.

### 2. Right-To-Represent Capture

**Scenario:** A recruiter pushes for a right-to-represent reply before confirming client, rate, model, contract length, or exclusivity.

**Impact:** Candidate gives away representation rights without knowing what was authorized.

**Controls:**

- no right-to-represent approval without client, role, rate, model, duration, exclusivity terms, and job ID
- require role-specific and time-limited authorization language
- store exact authorization text and timestamp as an artifact
- never accept right-to-represent automatically

**Enhancement:** Add a required `RTR_SCOPE` checklist before any stage can move to `submitted-to-client`.

### 3. Fake Recruiter / Identity Harvesting

**Scenario:** A contact asks for SSN, full date of birth, driver's license, passport, bank details, or references before a verified employer interview.

**Impact:** Identity theft, fraud, or private-data leakage.

**Controls:**

- suppress any pre-interview request for sensitive identity data
- verify recruiter email domain and company relationship
- verify the role on the official company careers page where possible
- escalate fake-check, gift-card, crypto, equipment-purchase, Telegram-only, WhatsApp-only, or text-only processes
- never store identity documents in the public repo

**Enhancement:** Add `identity-data-requested` and `payment-requested` hard-stop flags to the system of record.

### 4. Active Conversation Starvation

**Scenario:** Agents spend the morning sourcing and submitting new applications while an interview scheduler, recruiter screen, or offer signal sits unanswered.

**Impact:** Conversion loss despite high activity.

**Controls:**

- inbox and live-thread review runs before application volume
- daily rollup begins with active movement, not raw sends
- no sourcing automation until response queue is current

**Enhancement:** Add a `response_queue_current` boolean gate. Application volume cannot run unless it is true.

### 5. Generic Follow-Up Spam

**Scenario:** Agents generate polite follow-ups to ATS acknowledgements, no-reply inboxes, cold contacts, or low-fit roles.

**Impact:** Low-value messaging and relationship damage.

**Controls:**

- no follow-up without named contact or credible contact path
- no same-day bump unless scheduling, correction, or hot movement
- every follow-up must clarify terms, advance scheduling, add differentiated evidence, or close a loop

**Enhancement:** Add a `state_change_test` field: if the message cannot state what it changes, it cannot be sent.

### 6. Fabricated Or Overstated Fit

**Scenario:** An agent tailors too aggressively and implies skills, credentials, authorization, location, or availability that are not true.

**Impact:** Reputation damage, interview mismatch, or offer-stage failure.

**Controls:**

- no fabricated experience, credentials, compensation, authorization, location, or availability
- every tailored claim must map to candidate profile evidence
- guardrail reviewer checks claims before external sending

**Enhancement:** Add a `claim_evidence` field for each application artifact or cover note.

### 7. Attachment Misfire

**Scenario:** The wrong resume version, stale portfolio, or private document is attached to a recruiter reply.

**Impact:** Privacy breach or weak application.

**Controls:**

- no attachments without human approval
- artifact registry records filename, version, recipient, role, and approval
- never attach identity documents before verified process stage

**Enhancement:** Add an attachment manifest before any outbound email with files.

### 8. Lane Confusion

**Scenario:** The agent treats a consulting prospect, tax client, referral partner, or sensitive relationship as a job lead and starts job-search cadence.

**Impact:** Relationship damage and business-lane contamination.

**Controls:**

- classify contact lane before drafting
- `relationship-protected` classification overrides follow-up automation
- human approval required for sensitive contacts

**Enhancement:** Add a contact-level `lane` field and block job-pipeline automation when lane is not `job-search`.

## Reddit-Informed Enhancements

Reddit is not authority, but it is useful as a high-volume failure-mode sensor. Review of relevant `r/recruitinghell`, `r/jobs`, and `r/Scams` threads surfaced recurring practical risks:

1. **Duplicate submissions and right-to-represent disputes are common enough to deserve first-class controls.** Several threads describe candidates being warned that double submission can void or damage a candidacy. The plan should treat duplicate risk as a hard gate, not a note.
2. **Recruiter pressure around right-to-represent is a separate risk from ordinary follow-up.** Add a specialized RTR workflow with scope, client, rate, exclusivity, and timestamp fields.
3. **Identity-data requests are noisy and ambiguous.** Some staffing systems use partial identifiers, but Reddit threads also show repeated scam concerns around SSN, date of birth, driver's license, passport, and references. The safe default is hard-stop until employer/recruiter legitimacy is verified.
4. **Fake-check equipment scams are common enough to hard-code.** This is supported by both Reddit reports and FTC guidance. Any check, equipment-purchase, overpayment, gift-card, crypto, wire, or pay-to-work pattern should suppress the opportunity immediately.
5. **Generic ATS follow-up has low expected value.** The follow-up engine should not spend effort on generic acknowledgements without a named contact.
6. **Application quality and artifact version control matter.** Track exactly which resume/cover note was sent, through which channel, and when.
7. **Scam detection needs a contact-channel test.** Off-platform-only text, Telegram, Signal, WhatsApp, or non-corporate email should trigger verification before continuing.

## Sources Reviewed

- Quantyra job pipeline skills: `https://github.com/Quantyra/job-pipeline-agent-skills`
- Reddit failure-mode sample:
  - `r/recruitinghell` on right-to-represent confusion: `https://www.reddit.com/r/recruitinghell/comments/14o9v18/if_i_respond_confirm_to_a_right_to_represent_form/`
  - `r/recruitinghell` on duplicate submission and RTR conflict: `https://www.reddit.com/r/recruitinghell/comments/1czunvn/recruiter_suggests_i_withdraw_submission_with/`
  - `r/recruitinghell` on multiple recruiters for the same opening: `https://www.reddit.com/r/recruitinghell/comments/z7zd87/has_anyone_ever_had_multiple_recruiters_from/`
  - `r/recruitinghell` on recruiter requests for SSN and driver's license: `https://www.reddit.com/r/recruitinghell/comments/tn5rsq/recruiter_is_asking_for_my_ssn_copy_of_drivers/`
  - `r/jobs` on fake-check equipment scams: `https://www.reddit.com/r/jobs/comments/vj5yq6/is_it_normal_for_companies_to_send_you_a_check_to/`
  - `r/jobs` on generic application follow-up limits: `https://www.reddit.com/r/jobs/comments/1fzi08f/does_calling_after_applying_really_do_anything/`
  - `r/jobs` on Telegram/text-interview scam concerns: `https://www.reddit.com/r/jobs/comments/l4qmyd/is_this_a_scam_i_started_the_interview_via/`
  - `r/Scams` on fake-check equipment scams: `https://www.reddit.com/r/Scams/comments/1hpfhni/job_is_sending_a_check_for_equipment_for_work/`
- FTC job-scam guidance: `https://consumer.ftc.gov/articles/job-scams`

## Added Controls Recommended For Implementation

Add these fields to the system of record:

- `job_id`
- `source_url`
- `job_description_hash`
- `end_client_verified`
- `official_posting_url`
- `recruiter_domain`
- `contact_channel`
- `identity_data_requested`
- `payment_or_equipment_request`
- `rtr_requested`
- `rtr_scope`
- `rtr_exclusivity`
- `rtr_expires_on`
- `duplicate_risk_score`
- `artifact_manifest_path`
- `state_change_test`
- `lane`

Add these automation gates:

- `response_queue_current` must be true before sourcing/application volume.
- `duplicate_risk_score` must be 1 or human-approved before submission.
- `rtr_requested` requires human approval and populated RTR scope.
- `identity_data_requested` requires hard-stop review.
- `payment_or_equipment_request` suppresses by default.
- `lane != job-search` blocks job-pipeline cadence.
- `state_change_test` must be non-empty before follow-up draft can be approved.

## Test Cases

Use these synthetic tests before live operation:

1. Two recruiters pitch the same client under slightly different titles.
2. Recruiter asks for right-to-represent before naming the end client.
3. Contact asks for last four SSN digits and date of birth before any interview.
4. Fake remote role sends a check for equipment.
5. Generic ATS acknowledgement has no named contact.
6. Hiring manager replied yesterday and sourcing queue is trying to run today.
7. Consulting lead is misclassified as job-search.
8. Application artifact tries to attach the wrong resume version.

## Red-Team Verdict

The baseline plan is directionally strong because it privileges state, evidence, next action, and suppression. The main weakness is that several risks need to be promoted from prose rules into explicit fields and hard gates. The highest-priority changes are duplicate-risk scoring, RTR scope controls, identity/payment scam flags, state-change tests for follow-up, and a response-queue-current gate before application volume.
