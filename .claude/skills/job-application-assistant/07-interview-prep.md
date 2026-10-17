---
framework_version: 1.0.0
---

# Interview Preparation Guide

<!-- STAR drafts are grounded in supplied resume, LinkedIn, and project evidence; verify details before interviews. -->

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples

<!-- Confirm the exact personal contribution and any details not captured here before using these examples. -->

### 1. Building an inventory assistant (Python, SQL, applied ML)
**S:** Small retailers need a practical way to ask inventory questions and anticipate product demand, while protecting their underlying business data.
**T:** Build a local-first assistant that can answer inventory questions and provide useful forecasts without allowing the language model to execute unrestricted database operations.
**A:** Built a Python application using guarded, read-only SQL access, policy retrieval, and LightGBM demand forecasting. Added a 20-question evaluation set to test its behavior.
**R:** On the project evaluation, the forecasts beat a naive baseline on 81% of products, with MAE 2.74 versus 3.08.
**Use for:** "Tell me about a project you built"; "How do you make AI applications safer and more reliable?"

### 2. Turning an imbalanced prediction problem into a tested demo (Python, data science)
**S:** A large public competition dataset offered an opportunity to explore indicators associated with smartphone-use patterns.
**T:** Prepare the data, build a prediction model, and make the result accessible through a simple demo.
**A:** Worked with approximately 690,000 dataset rows, prepared a modeling workflow, and built a Streamlit prediction interface.
**R:** The LinkedIn project description reports approximately 0.963 AUC. Present this as a competition-dataset project, not a medical diagnostic tool.
**Use for:** "How have you taken a model from data to an application?"; "How do you communicate a technical result?"

### 3. Improving a Kaggle competition result (feature engineering, model evaluation)
**S:** The Spaceship Titanic competition required predicting passenger outcomes from structured data.
**T:** Develop a competitive model and evaluate alternative approaches.
**A:** Engineered features and combined CatBoost, LightGBM, and XGBoost in an ensemble.
**R:** Ranked 240th of 1,592 participants, placing in the top 15%.
**Use for:** "Tell me about a time you compared approaches"; "How do you evaluate and improve a model?"

### 4. Using sales information to guide inventory decisions (business analysis)
**S:** In a part-time Inventory Manager role at SCH HUB, stock and sales records needed to support routine inventory decisions.
**T:** Keep records organized and help identify which products were moving quickly or slowly.
**A:** Tracked incoming and outgoing stock in Excel, organized invoices and product records, reviewed sales trends, and shared insights with business owners.
**R:** The analysis helped inform reorder planning; no quantified business impact was recorded.
**Use for:** "How have you used data to influence a business decision?"; "How do you explain analysis to non-technical stakeholders?"

<!-- Add more STAR examples as needed. Aim for 4-6 covering different competencies. -->

## Common Tough Questions

### "Why did you leave SCH HUB?"
> My part-time Inventory Manager role ran from January 2025 to February 2026. I am now focusing on opportunities that connect my Computer Science studies with data analysis and applied machine learning. Keep the explanation factual and adapt it to the exact circumstances.

### "You don't have [specific skill/experience]."
> Acknowledge the gap directly. Connect it to adjacent evidence from coursework or projects, explain how you would learn the missing skill, and avoid presenting project experience as production experience.

### "Where do you see yourself in 5 years?"
> I want to have developed into a strong early-career data or machine learning practitioner who can take a problem from data preparation through evaluation and a useful application. I am looking for a role where I can contribute while continuing to learn from experienced teammates.

### "What's your biggest weakness?"
> No personal growth area has been recorded yet. Prepare an honest example and the specific steps you are taking to improve; do not use a generic weakness that is not true for you.

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
