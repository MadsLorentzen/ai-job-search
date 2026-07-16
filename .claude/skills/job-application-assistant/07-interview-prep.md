---
framework_version: 1.0.0
---

# Interview Preparation Guide

<!-- SETUP: STAR examples are personalized by running /setup based on your actual experience -->

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples

### 1. AI Takeoff & Estimation Platform (Computer Vision + Full-Stack SaaS)
**S:** Construction companies were manually measuring quantities from PDF/CAD drawings — slow, error-prone, and expensive.
**T:** Build an end-to-end AI-powered SaaS platform to automate this process at Redian Software.
**A:** Trained custom YOLOv8/v11-seg models on domain-specific datasets (rooms, windows, floor plans). Built FastAPI inference services, integrated with React.js + Node.js frontend, implemented scale detection with manual override logic for drawings with missing scale info. Added full SaaS features: RBAC, subscription workflows, real-time estimation.
**R:** Production-grade platform deployed and used by construction clients; reduced manual estimation effort significantly.
**Use for:** "Tell me about a complex project you built", "How have you applied AI/ML in production?"

### 2. LMS SaaS – Multi-Tenant Architecture (Backend Engineering + SaaS Design)
**S:** Client needed a scalable Learning Management System that could serve multiple organizations with strict data isolation.
**T:** Architect and build a multi-tenant LMS from scratch using Laravel.
**A:** Implemented org-based data isolation, RBAC, subscription plan management, dynamic resource restrictions. Built automated email workflows with Laravel Scheduler + Queue Workers. Integrated JWT auth, payment gateway, AI features, certificate generation, multi-language support.
**R:** Production SaaS serving multiple organizations; zero data leakage between tenants; automated workflows reduced manual ops.
**Use for:** "Describe a system you designed from scratch", "How do you handle multi-tenancy?", "Tell me about a backend challenge"

### 3. AI Tender Management System (LLM Prompt Engineering)
**S:** Companies were manually reviewing hundreds of tender documents to assess winning probability — time-consuming and inconsistent.
**T:** Build an LLM-driven pipeline to automate tender analysis and prediction.
**A:** Designed prompt-engineered workflows to extract key parameters (budget, timelines, eligibility, requirements) from tender documents. Built real-time analysis tracking and automated report generation in PDF/Excel/Word via React.js + Node.js services.
**R:** Clients could process tenders in minutes instead of hours; automated report generation eliminated manual formatting work.
**Use for:** "How have you used LLMs in production?", "Tell me about prompt engineering experience"

### 4. Switching from Intern to Full-Time SDE (Growth + Adaptability)
**S:** After 6 months as an intern at MaiVin (SAP/SQL focus), joined Redian as a full-time SDE in a completely different stack (Laravel, React, AI/ML).
**T:** Ramp up quickly on a new stack and contribute to production systems from day one.
**A:** Self-studied Laravel and React.js patterns, studied existing codebase, asked targeted questions, shipped first features within weeks. Applied transferable skills (SQL, backend logic, API design) while learning new frameworks.
**R:** Successfully transitioned and now leading AI-driven feature development within 6 months of joining.
**Use for:** "Tell me about a time you had to learn something quickly", "How do you handle new tech stacks?"

## Common Tough Questions

### "Why did you leave [previous company]?"
> My internship at MaiVin was a fixed-term contract. I joined Redian Software for a full-time SDE role with a stronger focus on product engineering and AI/ML, which aligns with my long-term goals.

### "You don't have [specific skill/experience]."
> I haven't used [X] directly, but I've worked with [adjacent technology] in production. I pick up new tools quickly — for example, I ramped up on Laravel and React.js when I joined Redian and was shipping features within weeks.

### "Where do you see yourself in 5 years?"
> I want to grow into a Senior Engineer or Tech Lead role at a product-focused company, specializing in AI-integrated systems. I'm particularly interested in LLM applications and agentic AI pipelines.

### "What's your biggest weakness?"
> I sometimes go deep on technical problems before stepping back to check if there's a simpler solution. I've been working on this by timebox-ing exploration phases and discussing approach with teammates earlier.

### "Why this company specifically?"
> Customize per company. Must reference: specific projects, company values, market position, or team structure. Never give a generic answer.

## Questions You Should Ask Interviewers

### About the Role
- "What does a typical week look like in this role?"
- "What would success look like in the first 6 months?"
- "What's the biggest challenge the team is facing right now?"

### About the Team
- "How big is the team, and how do you divide work?"
- "What does the development/project lifecycle look like, from idea to production?"
- "How do you onboard new team members?"

### About Tech & Growth
- "What's your current tech stack for [relevant area]?"
- "Is there room to grow into more architectural or strategic decisions?"
- "How does the team stay current with new tools and methods?"

### About Culture (use these to prevent disappointment)
- "How would you describe the team culture?"
- "What does professional development look like here?"
- "Is there flexibility for remote/hybrid work?"
- "What's the balance between development/new projects and maintenance work?"
- "How would you describe the leadership style in this team?"
- "What do people who thrive here have in common?"

## Phone/Video Interview Tips
- Have STAR examples written out (use this file)
- Keep a glass of water nearby
- Smile when speaking (it changes your tone)
- Ask for clarification if a question is vague
- It's OK to take 5 seconds to think before answering
- End with: "Is there anything else you'd like to know about my background?"

## After the Application (Best Practice)

### Follow-Up Etiquette
- **Don't call to "stand out"** or to learn more about the role post-submission - this risks a negative impression
- If the employer specified a timeline, respect it and wait
- If no timeline was given and significant time has passed (2+ weeks), a brief call to ask about status is acceptable
- If you have genuinely new, relevant information to share, a short follow-up is fine

### Thank-You Notes
- When you receive any update (interview invitation, rejection, or status update), send a brief thank-you message
- Express appreciation for their time and the process
- Keep it short (2-3 sentences)

## Roleplay Guidelines
When the user asks for interview practice:
1. Ask which role/company to simulate
2. Start with easy warm-up questions ("Tell me about yourself")
3. Progress to role-specific technical questions
4. Include 1-2 behavioral questions using the competencies from the job posting
5. End with a tough question or curveball
6. After each answer, give brief feedback: what worked, what to sharpen
7. Suggest which STAR example would work best for each question
