---
framework_version: 1.1.1
---

# Candidate Profile

<!-- Populated by /setup Path A on 2026-10-14 from documents/cv/Mohit_Notani_Master_Resume.docx.pdf and documents/linkedin/Profile.pdf. Where they disagreed, the CV (most recently updated) was used. -->

## Identity
- **Name:** Mohit Notani
- **Location:** Dublin, Ireland
- **Phone:** +353 89 945 6217
- **Email:** mohitnotani97@gmail.com
- **LinkedIn:** https://www.linkedin.com/in/mohit-notani
- **GitHub:** https://github.com/Mohit9674
- **Portfolio:** https://mohit9674.github.io
- **Status:** Employed as Assistant Manager at Holland & Barrett (retail); seeking a move into data/QA roles. Available immediately.
- **Work authorisation:** Stamp 1G (Irish Graduate Visa), valid until December 2027. Eligible for a Critical Skills Employment Permit (Data Engineer, Data Analyst and Data Scientist are on Ireland's Critical Skills Occupations List). Needs employer sponsorship to stay beyond December 2027.
- **Constraints:** Based in Dublin; Dublin-area hybrid or on-site roles; fully remote within Ireland also acceptable.

### Languages

| Language | Level | Notes |
|----------|-------|-------|
| English | C1 | Professional working language |
| Hindi | Native | |

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| MSc Data Analytics, First Class Honours (1:1) | 2024-2025 | National College of Ireland, Dublin | Thesis: LLM + time-series stock price prediction (FinBERT + Prophet) |
| BE Information Science and Engineering | 2017-2021 | Visvesvaraya Technological University (VTU), India | |

### Certifications
- **AWS Certified Cloud Practitioner** - completed June 2026
- **In progress:** Microsoft DP-700 Fabric Data Engineer, dbt Fundamentals, Databricks Lakehouse Fundamentals, Google Data Analytics

## Professional Experience

### Assistant Manager - Holland & Barrett (Oct 2025 - Present)
Dublin, Ireland
- Reduced stock discrepancies by 36% across 1,000+ SKUs since Oct 2025 through regular stocktakes and a theft tracking system, applying Lean principles.
- Cut reconciliation errors by 30% across 300+ daily payment transactions (EUR 20k+/day) by introducing standardised daily validation checks.
- Track daily KPIs (sales, items per basket, average order value, loyalty sign-ups) and lead a team of 6.
- Use the store's point-of-sale (POS) system daily to serve customers and process transactions (confirmed by the candidate 2026-10-14; system name not given; customer-facing use only - not confirmed for stock management).
- Promoted from Retail Assistant in 10 months.

### Data Engineering Analyst - Quality Automation - Accenture Solutions Pvt. Ltd. (Jul 2023 - Jul 2024)
Bangalore, India
- Defined the test strategy, test plans, acceptance criteria and data-quality rules for 40+ releases, validating 8 source systems through to the reporting layer for a 6-engineer workstream.
- Tripled regression coverage from 40 to 120 tables by extending Robot Framework packs with transformation, null, duplicate and referential-integrity checks.
- Cut manual testing effort by 30% by automating SQL and Python reconciliation checks (row counts, schema, nulls) on AWS Glue and Redshift tables feeding Power BI reports.
- Reduced release deployment time by 20% by gating every production merge on automated tests in a Jenkins CI/CD pipeline.

### Development Analyst - Accenture Solutions Pvt. Ltd. (Jan 2022 - Jun 2023)
Bangalore, India
- Reduced production data errors by 15% by building 500+ Robot Framework test cases with custom SQL and Python keywords for source-to-target validation across 8 systems.
- Halved regression cycles from 4 to 2 per release by replacing manual SQL and spreadsheet checks with automated regression packs.
- Built a UI test automation framework in Robot Framework and Selenium, automating 500+ regression and smoke tests with reusable keywords, plus API tests in Postman.
- Managed defects end to end in Jira and HP ALM, tracing root causes and retesting fixes for 8-12 stakeholders in Agile/Scrum sprints.

<!-- Excel at Accenture (confirmed by the candidate 2026-10-14): used VLOOKUP and pivot tables to read and analyse source tables during data validation. Role (Development Analyst vs Data Engineering Analyst) not specified - attribute to "Accenture" generally. -->
<!-- Total Accenture tenure: Jan 2022 - Jul 2024 (2 years 7 months; the CV says "2.5 years"). -->
<!-- Note: "500+" appears in both Development Analyst bullets (Robot Framework test cases; UI regression/smoke tests). Confirm whether these are the same set before using both in one document. -->

## Independent Projects
- **Real-Time Dublin Bus Pipeline** (Kafka, PySpark, dbt, Dagster, Docker, PostgreSQL): Streaming medallion pipeline that ran for 3 months with zero downtime, ingesting GTFS-Realtime feeds every 5 seconds via Kafka, PySpark and dbt into a partitioned PostgreSQL Gold layer. dbt tests and automated data-quality checks keep bad records out of Gold; orchestrated with Dagster in Docker.
- **LLM + Time-Series Stock Price Prediction (MSc thesis)** (Python, FinBERT, Prophet, dbt, PostgreSQL, GitHub Actions): Cut 30-day out-of-sample forecast error (RMSE) by 39.2% against a baseline Prophet model by adding FinBERT news-sentiment features. Automated NewsAPI and yfinance ingestion into a dbt-modelled PostgreSQL layer with data-quality checks and GitHub Actions CI/CD.
- **NYC Taxi Demand and Weather Analysis** (Apache Spark, PostgreSQL, Streamlit, Plotly): Joined 100M+ taxi trip records with NOAA weather data in Spark; sped up PostgreSQL queries by 60%+ via partitioning and indexing.
- **Multi-Model Temporal Event Detection - Soccer Analytics** (PyTorch, TCN, CNN-LSTM, Transformer, CALF): Benchmarked 4 deep learning models for action spotting on SoccerNet-v2 by mAP. Preprocessed ResNet-152 features with Gaussian label smoothing; orchestrated training and evaluation as DAG pipelines.

## Technical Skills

### Testing & QA
- Test strategy & test plans, test case design, regression & smoke testing, ETL testing, API testing (Postman), defect lifecycle & RCA
- Robot Framework, Selenium, Jira, HP ALM, Agile/Scrum

### Data Quality
- Source-to-target reconciliation, data validation & profiling, referential-integrity checks, dbt tests

### Data Engineering
- **SQL** (advanced)
- **Python** (Pandas, NumPy), PySpark
- Apache Kafka, dbt, Dagster, ETL/ELT, dimensional modelling (star schema), medallion architecture

### Cloud, DevOps & BI
- AWS (Glue, S3, Redshift), Microsoft Fabric
- Docker, Terraform, Git, GitHub Actions CI/CD, Jenkins, Linux
- PostgreSQL, MongoDB
- Power BI, Excel (VLOOKUP, pivot tables)
- Retail point-of-sale (POS) system (daily, customer-facing use)

### ML (project-level)
- PyTorch, FinBERT, Prophet, Streamlit, Plotly

## Publications
None listed.

## Awards
- First Class Honours (1:1), MSc Data Analytics - National College of Ireland (2025)

## References
Available upon request.
