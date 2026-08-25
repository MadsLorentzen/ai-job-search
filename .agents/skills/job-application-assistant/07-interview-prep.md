---
framework_version: 1.0.0
---

# Interview Preparation Guide

## STAR Format
Structure answers as: **Situation** (context), **Task** (your responsibility), **Action** (what you did), **Result** (outcome).

Keep answers to 1-2 minutes. Be specific. End with what you learned or would do differently.

## Ready-Made STAR Examples for Nehul Bhatnagar

### 1. Enterprise RAG Documentation Engine (Revionics)
**S:** Internal documentation and client technical documents were dense, unstructured, and causing high ticket resolution times across global customer success teams.
**T:** Architect and deploy an enterprise-grade RAG pipeline capable of accurate retrieval and answer generation over complex documents.
**A:** Built a modular pipeline combining embedding generation, hybrid search with vector DBs (Pinecone/FAISS), and prompt-engineered LLM generation with citation grounding. Containerized and deployed via FastAPI.
**R:** Reduced support ticket resolution time by >70% and streamlined domain knowledge onboarding.
**Use for:** "Tell me about a complex LLM system you built", "How do you handle retrieval over large document sets?"

### 2. High-Throughput Cost & Pricing Microservice (Revionics)
**S:** Critical retail pricing calculation services suffered from compute cost bloat and high latency under heavy client loads.
**T:** Redesign and optimize the calculation backend for extreme efficiency and low-latency throughput.
**A:** Developed *CostChangeWizard*, containerizing high-performance REST APIs in FastAPI with optimized async routines, memory management, and Kubernetes horizontal pod autoscaling.
**R:** Reduced annual cloud compute costs by >$100,000 and slashed API latency by >80%.
**Use for:** "How do you optimize system performance and cloud costs?", "Describe a backend microservice you designed."

### 3. Distributed Social Intelligence Stream (Coinbase)
**S:** Crypto market sentiment moves rapidly on social media, requiring near real-time extraction of structured sentiment and narrative signals.
**T:** Build an end-to-end scalable ingestion and NLP model pipeline handling high message velocity.
**A:** Engineered fault-tolerant Apache Airflow pipelines ingesting >15,000 tweets/hour. Implemented topic clustering using BERTopic combined with dense LLM embeddings.
**R:** Delivered reliable, low-latency market signal feeds for quantitative downstream intelligence.
**Use for:** "How do you handle streaming/high-velocity data pipelines?", "Describe your experience with NLP and topic modeling."

### 4. Distributed Trade Pipeline Optimization (Goldman Sachs)
**S:** Legacy Kafka batch processing pipelines for trade data took 14+ hours per run, causing regression testing bottlenecks across global teams.
**T:** Architect a high-throughput multiprocessing pipeline to compress runtime.
**A:** Redesigned the stream processing architecture with multiprocessing workers and unified fragmented regression environments.
**R:** Accelerated processing throughput by 700% (from 14 hours to <120 mins) across 6M+ messages (60GB+ per run).
**Use for:** "Tell me about a time you optimized a slow distributed pipeline", "How do you debug bottlenecks in Kafka/data processing?"

## Questions You Should Ask Interviewers

### About Tech & Architecture
- "What does your current model inference stack look like, and how do you handle evaluations and guardrails in production?"
- "How is the engineering team balancing new LLM feature development versus data pipeline and latency optimization?"
- "What is the biggest scalability or reliability challenge the ML/AI platform is facing right now?"

### About Culture & Team
- "How does the team handle autonomy and technical decision making across projects?"
- "What do engineers who thrive the most in your organization have in common?"
