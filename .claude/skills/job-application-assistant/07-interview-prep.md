---
framework_version: 1.0.0
---

# Interview Preparation Guide

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples

### 1. Automated RAG evaluation pipeline (technical depth / automation / initiative)
**S:** During my AI Testing internship at VisionMatrix Technology (Hong Kong), the team was evaluating the quality of the RAG system/agent behind an online ordering platform.
**T:** Build an automated way to evaluate the agent's answers instead of relying on manual spot-checks.
**A:** Deployed the API server locally in containers with varying environment variables to reproduce different configurations; set up a local LLM server to generate test cases; applied both fixed rules and an LLM-based evaluation framework as the judge; generated an HTML report from the results.
**R:** Delivered a working automated evaluation pipeline plus an HTML report summarizing results, with recommendations for improvements and future test cases.
**Use for:** "Tell me about a technical project", "Have you automated anything?", "What have you built with LLMs?"

### 2. UAT of a speech-to-text system and AI avatar (quality mindset / attention to detail)
**S:** As a UAT Testing Intern at VisionMatrix's Shenzhen office, the company was shipping a speech-to-text (STT) system and an AI avatar for an online ordering platform.
**T:** Plan and execute user-acceptance tests so that problems reached developers as reproducible findings.
**A:** Planned and executed the tests; drafted a "hot words" list for the STT system; recorded reproducible bugs in the ordering system; reviewed backend source code and wrote data-processing scripts to verify that content retrieved from the vector database via RAG matched the tool-calling interface.
**R:** Bugs were logged reproducibly for the dev team, and retrieval-versus-interface mismatches were surfaced systematically by script rather than by chance.
**Use for:** "Tell me about your attention to detail", "Experience with testing?", "Working with another team/office?"

### 3. Object detection data labeling and model benchmarking (ML fundamentals / evaluation methodology)
**S:** During the Shenzhen internship, the team was training an object detection model on video frames.
**T:** Prepare training data and assess which open-source object detection models were effective for the task.
**A:** Labeled video frames for training; ran and compared the effectiveness of multiple open-source object detection models.
**R:** Produced a labeled training dataset and an effectiveness comparison across candidate models.
**Use for:** "Any hands-on ML experience?", "How do you evaluate models?", "Is data quality important?"

### 4. AI Society External VP election campaign (communication / persuasion)
**S:** I ran for External Vice-President of the Artificial Intelligence Society at CUHK; the role is elected by students in the AI major.
**T:** Convince AI-major students that the society - and my candidacy - was worth their vote.
**A:** Promoted the society and my platform directly to students across the major during the campaign period.
**R:** Achieved a 36.4% voting rate and won the election; went on to serve the full year (Jan 2025 - Jan 2026).
**Use for:** "Tell me about a time you persuaded people", "Communication example", "Selling an idea"

### 5. Engineering Orientation Camp 2025 (leadership / organization)
**S:** CUHK's Engineering Orientation Camp 2025 was a 3-day camp for over 200 incoming freshmen.
**T:** Help organize the camp and lead a group of 12 freshmen through the activities.
**A:** Assisted the organizing team with camp logistics and activities; guided my group of 12 through the program to help them get familiar with the university.
**R:** Delivered the full 3-day program for my group as part of the 200+ freshman camp.
**Use for:** "Leadership example", "Tell me about teamwork", "Handling responsibility for a group"

### 6. Homework Management System (end-to-end delivery / requirements discovery)
**S:** In high school, my economics teacher had difficulty analyzing students' performance across assignments.
**T:** Design and build a solution that actually solved her analysis problem - not just a generic tool.
**A:** Interviewed the teacher to discover the real pain point; proposed a web application using tags and diagrams with an explicit list of success criteria; designed the database, screen layouts, and UML diagrams plus a test plan; developed it in an MVC-based architecture with documentation; then tested it and evaluated it against the success criteria.
**R:** Delivered a working, documented system that met the agreed success criteria, and identified concrete future improvements.
**Use for:** "Walk me through a full project lifecycle", "How do you gather requirements?", "Initiative outside class"

### 7. Movie Recommender System (end-to-end NLP project / applied ML)
**S:** I wanted hands-on practice with the Python data stack beyond coursework, so I built a content-based movie recommender as a personal project (Jan-Feb 2026).
**T:** Take a raw movie dataset to a working web app that recommends similar movies.
**A:** Processed the dataset and extracted descriptive words with Pandas; removed morphological affixes with NLTK; performed word vectorization and cosine-similarity computation with Scikit-Learn; built a web interface where users choose a movie and get recommendations ranked by description similarity; loaded movie posters via REST API.
**R:** Delivered a working recommender web app covering the full pipeline from raw data to user interface.
**Use for:** "Walk me through an ML project", "Any NLP experience?", "Tell me about a project you drove end to end"

### 8. DQN vs A3C deep reinforcement learning comparison (self-directed research / objective evaluation)
**S:** Before university (Jun 2023 - Jul 2024), I ran a comparative study of two deep reinforcement learning algorithms, DQN and A3C.
**T:** Research both algorithms and compare their effectiveness on a concrete control problem.
**A:** Researched and analyzed DQN and A3C; implemented both to control traffic lights in a simulated environment; compared their effectiveness in reducing traffic congestion; evaluated the results while explicitly considering the investigation's limitations.
**R:** Produced a like-for-like comparison of the two algorithms on the traffic-control task, with limitations acknowledged.
**Use for:** "Tell me about self-directed learning", "Research experience?", "How do you compare two approaches objectively?"

### 9. Teaching coding to children aged 4-15 (communication to non-technical audiences)
**S:** At Cobo Academy (summer 2025), I taught project-based coding to children whose ages ranged from 4 to 15, in both English and Mandarin.
**T:** Keep lessons engaging and understandable across a huge age and ability range, including 4 camps at Canadian International School and Chinese International School.
**A:** Planned lesson flows and prepared instructional materials tailored to each group; conducted 10 weeks of lessons; coordinated with fellow instructors and communicated with parents about progress.
**R:** Delivered the full 10-week program and 4 international-school camps, with parent communication throughout.
**Use for:** "Explain something technical to a non-technical audience", "Tell me about adapting your communication style", "Experience with mentoring or teaching?"

### 10. Elderly home-safety service-learning (initiative / reporting to an external authority)
**S:** In a CUHK service-learning project (Feb-Mar 2025), we worked with mobility-impaired elderly residents on home safety.
**T:** Understand the residents' real risks and awareness gaps, and do something useful with what we found.
**A:** Surveyed 50 elderly people and found low awareness of anti-slip prevention and the Building Maintenance Grant Scheme for Needy Owners (BMGSNO); helped install anti-slip accessories in a resident's bathroom; investigated the BMGSNO and discovered renovation companies were charging applicants higher prices because of the scheme's complicated application procedure.
**R:** Reported our findings to the Urban Renewal Authority with concrete recommendations: stronger promotion of anti-slip education and subsidy programs, a contractor certification mechanism, and a standardized renovation contract template.
**Use for:** "Tell me about community impact", "A time you escalated a finding", "Investigating a problem beyond the obvious"

<!-- Library of STAR examples - pick the best fit per question; do not recite all of them. -->

## Common Tough Questions

### "Why did you leave VisionMatrix?"
> Both were fixed-term summer internships (June-July in Shenzhen, July-August in Hong Kong) - they ended as scheduled, and I'm now back for Year 3 at CUHK. The experience confirmed I want to work on real AI systems, which is exactly why I'm here.

### "You don't have PyTorch/TensorFlow / model-training experience."
> That's a fair gap - my industry work so far has been on the evaluation side of AI: benchmarking open-source detection models and building an LLM evaluation pipeline. My Python and C foundation is solid, I'm covering the theory in my CUHK coursework now, and I self-teach fast - I set up a local LLM server on my own during my internship when the task called for it.

### "Where do you see yourself in 5 years?"
> Graduating in 2028, then working as an AI engineer - ideally in a startup environment like HKSTP or Cyberport, where I can grow from evaluation and testing toward owning model and LLM systems end to end.

### "What's your biggest weakness?"
> Repetitive manual work genuinely drains me - but I've learned to channel that: when I hit a repetitive task, I build tooling to eliminate it. That's literally how my automated RAG evaluation pipeline came to exist. I still have to be deliberate about tasks that can't be automated, and I handle those by time-boxing them.

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
