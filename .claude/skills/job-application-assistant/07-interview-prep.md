---
framework_version: 1.0.0
---

# Interview Preparation Guide

<!-- SETUP: STAR examples are personalized by running /setup based on your actual experience -->

## STAR Format

Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples

<!-- These are populated by /setup from your actual experience. Templates 6-8 show the format for further additions. -->

### 1. Tukey No-Code AI 平台創立 (0-to-1 產品策略 / Vision)
**S:** 過去團隊以資料分析專長協助企業導入 AI，但發現高達八成的資料科學專案在結案後就停擺——工廠環境與機台會變化，ML 模型上線後若無人維護，準確度就會衰退。
**T:** 找出讓 AI 模型在工廠現場能長期被正確維運的方法，而不是做一次性的顧問專案。
**A:** 判斷「最懂現場的人才最適合維運模型」，因此主導打造 No-Code AI 建模與維運平台 Tukey，讓不懂寫程式的第一線廠務、製程工程師能自行建立並長期維運 AI；平台以 IoT 數據建立機台健康時的「行為輪廓」，數據偏移即提前預警並指出可能原因。
**R:** 台塑等石化、鋼鐵大廠導入後大幅縮短維修時間、避免檢修人力浪費；平台可讓製造業在 3 個月內快速將 AI 導入數十間工廠。
**Use for:** "0-to-1 product experience", "product vision", "why manufacturing AI", "biggest product you've built"

### 2. 從平台走向場景化產品線 (產品策略 / 市場定位)
**S:** 水平型平台式產品在銷售時，客戶常常不清楚這個產品到底能解決什麼問題，銷售週期長達 5-6 個月。
**T:** 重新定位產品，讓銷售團隊與經銷商能更快、更精準地鎖定客戶需求。
**A:** 歸納製造業常見的應用場景（設備異常偵測、產品品質預測、生產參數最佳化），把場景常用的演算法與工具整理成獨立產品線。
**R:** 銷售週期從 5-6 個月縮短至 3 個月。
**Use for:** "product positioning", "go-to-market strategy", "data-driven decision", "product segmentation"

### 3. AI-first 轉型：把產品改成 MCP (策略調整 / 對新技術的應變)
**S:** Gen AI 問世後，我們判斷下一代的產品使用者將是透過自然語言呼叫工具的 AI，而非人類直接操作介面。
**T:** 讓 Tukey 能被 AI 模型調用，同時確保 AI 建置出來的應用符合公司的技術棧與設計規範。
**A:** 主導把 Tukey 產品介面改為 MCP，供 AI 模型調用；制定公司 Design system 與 AI 開發指引；並強化資料重力——記錄資料清理歷程、模型漂移後的再訓練歷程，累積特定領域的特徵變數等隱性知識。
**R:** 原廠與經銷商的專案導入人員能用 AI 加速 Tukey 模型與應用建置，導入時間從 3 個月縮短至 1 個月。
**Use for:** "adapting to new technology", "strategic pivot", "AI product strategy", "staying ahead of market shifts"

### 4. 即時通知機制：Polling 到 WebSocket (技術取捨)
**S:** 模型建置完成後需要通知使用者，初期產品使用人數少，選用開發成本最低的 polling 機制，但無法即時通知。
**T:** 隨著使用人數成長，加上新增「自動建模」可同時建立多個模型的功能，需要提升通知即時性與使用者體驗。
**A:** 評估開發成本與使用者規模的取捨後，將通知機制改為 WebSocket，模型一建置完成就即時推播通知。
**R:** 使用者能立即得知多個模型的建置狀態，體驗大幅提升，不必再手動重整或等待輪詢。
**Use for:** "technical trade-off decisions", "engineering vs UX priorities", "scaling a feature"

### 5. 繪圖效能瓶頸：Scatter Plot 到蜂巢圖 (技術/設計取捨)
**S:** 客戶廠區的電腦設備老舊，資料探索功能中的散布圖在資料筆數過多時會持續轉圈、無法繪出。
**T:** 在不更換客戶硬體的前提下，讓使用者仍能透過圖表理解資料分佈。
**A:** 釐清圖表的目的是呈現資料分佈、而非呈現每一個資料點，因此改用蜂巢圖（hexbin），以顏色深淺表示點的密集程度，取代逐點繪製。
**R:** 圖表得以在低階設備上順暢渲染，同時保留使用者理解資料分佈所需的資訊。
**Use for:** "performance vs functionality trade-off", "design thinking under constraints", "solving for the underlying user need"

### 6. [PROJECT_NAME] ([SKILL_DEMONSTRATED])
**S:** [CONTEXT - what was happening, what was the problem]
**T:** [YOUR RESPONSIBILITY - what you specifically needed to do]
**A:** [WHAT YOU DID - specific actions, tools, methods]
**R:** [OUTCOME - measurable results, adoption, impact]
**Use for:** "[QUESTION_TYPE_1]", "[QUESTION_TYPE_2]"

### 7. [PROJECT_NAME] ([SKILL_DEMONSTRATED])
**S:** [CONTEXT]
**T:** [YOUR RESPONSIBILITY]
**A:** [WHAT YOU DID]
**R:** [OUTCOME]
**Use for:** "[QUESTION_TYPE_1]", "[QUESTION_TYPE_2]"

### 8. [PROJECT_NAME] ([SKILL_DEMONSTRATED])
**S:** [CONTEXT]
**T:** [YOUR RESPONSIBILITY]
**A:** [WHAT YOU DID]
**R:** [OUTCOME]
**Use for:** "[QUESTION_TYPE_1]", "[QUESTION_TYPE_2]"

<!-- Add more STAR examples as needed. Aim for 4-6 covering different competencies. -->

## STAR Candidates (Complete Manually)

These achievements are not yet covered by a full STAR example above. Fill in Situation/Task/Action/Result before using them in interviews.

### DSP - Domestic-violence risk-prediction model
**Source:** CV / LinkedIn - Data Analyst, DSP (2017-2021)
**What happened:** Integrated case histories across 11 cross-agency departments to build a risk model that triaged incoming cases; reduced domestic-violence recidivism by 30%.
**Why it matters:** analytics-for-social-impact, cross-stakeholder integration, model deployed into a real workflow; answers "data project with real-world impact", "working across many stakeholders"
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### DSP - Design-thinking workshops converting to clients
**Source:** CV / LinkedIn - Data Analyst, DSP (2017-2021)
**What happened:** Hosted 20+ design-thinking data workshops across petrochemical, automotive, banking, and government sectors; 70%+ of participants became paying clients.
**Why it matters:** client-facing, business development, facilitation; answers "influencing without authority", "driving revenue", "stakeholder communication"
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### Chimes AI - China Steel Chemical energy optimization
**Source:** CV - Director of Product, Chimes AI
**What happened:** Deployed an energy-optimization module for an electric-boiler drying process, cutting per-batch energy ~32% and ~200 tons/yr CO2.
**Why it matters:** measurable ESG/business impact, technical delivery; answers "biggest impact", "sustainability", "delivering ROI"
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

### Chimes AI - Point-to-point to platform transformation
**Source:** CV / LinkedIn - Product Manager, Chimes AI (2021-2022)
**What happened:** Transformed delivery from custom point-to-point projects (5 eng / 3 yr / 40 projects) to platform-based deployment (15 eng / 3 mo / 400+ models).
**Why it matters:** scaling, operating-model change, platformization; answers "improving a process", "scaling a team/product", "0-to-1 to 1-to-n"
**S/T/A/R stub:**
- Situation:
- Task:
- Action:
- Result:

## Product Deep-Dive Case Study

<!-- For "walk me through a product you worked on" style questions - a full business/product/tech/design discussion of one real product, distinct from the STAR-format answers above. -->

### Q: 針對你過去實際參與的一個產品展開全面性討論，包含但不限於商業、產品、技術、設計等面向。
**Use for:** deep-dive / case-study rounds, senior PM technical rounds, "walk me through a product you built" prompts

**Product:** Tukey - No-Code AI 建模與維運平台 (Chimes AI)

#### 產品發展階段

##### 2021 - 2023：水平型平台式產品

**創辦動機**

創始團隊過去長期以資料分析專長協助企業導入 AI。但是我們發現，多數企業花大錢做的資料科學專案，高達八成在專案結束後就停擺。原因是工廠環境會變、機台會老化，ML 模型一旦上線，如果沒有持續維護，準確度就會衰退。

我們認為：要維運 ML 模型，一定要了解現場實務，因此維運的工作最適合交給製造業中那些最懂現場的人。因此決定打造一個 No-Code（無程式碼）的 AI 建模與維運平台——Tukey，讓不懂寫程式的第一線廠務、製程工程師，都能用友善的介面，自行建立並長期維運 AI。

**市場痛點**
- 現場專家不懂程式，AI 工程師不懂現場：IT 部門或外部顧問不懂工廠上千種管線與機台的運作邏輯（Domain Knowledge），做出來的模型不切實際；而最懂現場的資深黑手、製程工程師卻不會寫 Python。
- 設備異常代價高昂：石化、鋼鐵或半導體等大廠，只要一條生產線無預警停機，造成的產能缺口與維修成本動輒百萬、千萬起跳。
- ESG 與減碳壓力：高耗能產業面臨巨大的碳排與節能壓力，傳統經驗法則已無法榨出更多節能空間。

**商業動機**
- 極低門檻取代高額人事成本：企業訂閱 Tukey 平台的費用，遠低於聘請一整個 AI 團隊。平台能讓製造業在 3 個月內快速將 AI 導入數十間工廠。
- 資產管控與設備預警：系統以 IoT 數據為基礎，建立機台健康時的「行為輪廓」。只要運作數據稍微偏移，AI 就會提前預警並指出可能原因。例如：台塑等石化、鋼鐵大廠導入後，能大幅縮短維修時間、避免檢修人力浪費。

##### 2024 - 2025：特定應用場景的解決方案

**決策依據**

經過前幾年與市場的互動，我們發現在銷售的時候，若是以水平型平台式產品呈現，通常客戶還是不知道這個產品可以解決什麼問題。於是我們歸納出幾個製造業常見的應用場景（設備異常偵測、產品品質預測、生產參數最佳化），並且把這些場景常用到的演算法或工具，整理成不同的產品線。

**成果**

這樣的調整可以幫助銷售團隊與經銷商更快速、精準地鎖定客戶的需求。銷售週期從 5-6 個月，縮短至 3 個月。

##### 2026：AI-first 產品

**決策依據**

在 Gen AI 問世後，軟體業受到極大的挑戰。我們體認到下一個世代的使用方式會是人類使用者透過自然語言請 AI 調用 Tukey 產品，打造並維運 ML 應用。因此 AI 才是未來產品真正的使用者。

對此，產品團隊快速進行調整。我們把 Tukey 產品改成 MCP，讓 AI 模型調用。制定公司的 Design system 和 AI 開發指引，讓 AI 開發出來的應用都使用指定的技術棧、符合設計規範。

另外，我們也在資料重力上著墨更多，像是提供更詳細的資料清理歷程記錄功能、模型漂移後的模型再訓練歷程記錄，累積特定領域使用的模型使用的特徵變數，把這些隱性知識記下來，可以讓模型更好用，提升客戶黏著度。

**成果**

Tukey 產品改成 MCP 後，原廠和經銷商的專案導入人員可以使用 AI 加速 Tukey 模型與應用的建置，讓導入時間從原本的 3 個月縮短至 1 個月。

#### 技術取捨

##### 場景：模型建置完成通知的實作機制

Phase 1 先求有這個功能，而且產品使用人數也沒有很多，因此選用開發上最輕量的 polling 機制，但他的壞處就是沒有辦法即時通知。

後來隨著產品使用人數增加，再加上支援「自動建模」同時建立多個模型的功能之後，我們就改用 WebSocket，一完成就通知，提升使用者體驗。

##### 場景：繪圖效能瓶頸

客戶廠區裡的電腦非常老舊，螢幕是正方形的那種。Tukey 產品裡面有個資料探索功能，可以對不同欄位繪製圖表。其中散布圖 scatter plot 在資料筆數太多的時候，會一直轉不出來。

圖表的功能是為了讓 User 了解資料的分佈，因此不需要全部把所有的點都畫出來，我們最後採用了蜂巢圖來呈現，顏色越深的格子表示點點分佈越多。

## Common Tough Questions

### "Why did you leave [previous company]?"
> [PREPARE YOUR ANSWER - be honest, forward-looking, no negativity about former employer]

### "You don't have [specific skill/experience]."
> [PREPARE YOUR ANSWER - acknowledge the gap, bridge to adjacent experience, show willingness to learn]

### "Where do you see yourself in 5 years?"
> [PREPARE YOUR ANSWER - show ambition aligned with the role's growth path]

### "What's your biggest weakness?"
> [PREPARE YOUR ANSWER - genuine weakness with concrete mitigation strategy]

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
