---
framework_version: 1.0.0
---

# Candidate Profile

<!-- SETUP: This file is populated by running /setup -->
<!-- After running /setup, all sections will be filled with your actual information -->

## Identity
- **Name:** Hokam Singh
- **Location:** Indore, India
- **Phone:** +91-7804010021
- **Email:** hokamsingh07@gmail.com
- **LinkedIn:** https://linkedin.com/in/hokamsingh
- **GitHub:** Not provided
- **Languages:** English (professional), Hindi (native)
- **Status:** Employed (Senior Software Backend Engineer, TrueIgTech) - passively open to new opportunities
- **Work Authorization:** Indian citizen. No pre-existing work authorization outside India - roles in Denmark/Europe/US require employer visa sponsorship. Run the Eligibility Gate in `04-job-evaluation.md` on every non-India posting before scoring.
- **Constraints:** Prefers remote. Priority market is the **US (USD-denominated compensation preferred)**, then wider Europe/Denmark, then relocation within India (Indore, Bengaluru, Ahmedabad, or elsewhere in the country) - all subject to visa sponsorship outside India.

## Education

| Degree | Period | Institution | Key Topics |
|--------|--------|-------------|------------|
| BCA (Bachelor of Computer Application) | Jul 2020 - Apr 2023 | Vikram University Ujjain (Mandsaur, Madhya Pradesh) | Computer Applications |

## Professional Experience

### Senior Software Backend Engineer - TrueIgTech (i-Gaming) (Sep 2025 - Present)
Indore, India
Project: PrizePlanet - Multi-Brand iGaming Platform (B2C + B2B White-Label)
- Rebuilt third-party game automation from full browser-driven sessions to a hybrid browser+API model, cutting per-action latency from 15-25s to ~300ms and eliminating timeout/crash failures from long-running browser sessions
- Built a Redis-backed caching layer for high-traffic API paths: stale-while-revalidate with distributed refresh locking to prevent thundering-herd on expiry, plus pattern-based cross-service invalidation, cutting primary-database load and serving hot-path reads in milliseconds
- Built and hardened the payment stack: Apple Pay, Google Pay, and card rails through PayCom plus Fyntek for payouts, with idempotent webhook handling and a batched, lock-protected reconciliation worker to catch drift against provider records
- Migrated core analytics from PostgreSQL (OLTP) to ClickHouse (OLAP): designed the schema using purpose-fit engines (AggregatingMergeTree, SummingMergeTree, ReplacingMergeTree) with hourly pre-aggregated materialized views, cutting dashboard queries from full table scans to sub-second lookups
- Hardened casino bet-callback handlers for high-throughput concurrent play: row-level wallet locking, idempotent processing, and async offload of tournament/mission/VIP progress onto BullMQ workers to keep the settlement path fast
- Built a standalone real-time chat microservice from the ground up, horizontally scalable via a Redis pub/sub adapter across Socket.io instances, with moderation/anti-spam, tipping, and cached paginated history

### Software Backend Engineer - Codes For Tomorrow (Oct 2023 - Sep 2025)
Indore, India

**Verslan - High-Frequency Crypto Trading Platform** (TypeScript, NestJS, PostgreSQL, Prisma, Redis, Docker, BullMQ, BlockBee, CoinMarketCap API)
- Engineered a scalable swap-matching engine using BullMQ job queues, reducing swap agreement latency by 65% and handling 500+ concurrent swap requests against an ACID-compliant PostgreSQL schema
- Integrated the BlockBee payment gateway with a fault-tolerant webhook system achieving 99.8% transaction consistency, with automated retry logic and failover syncing for wallet top-ups and withdrawals
- Built a real-time price sync processor consuming CoinMarketCap APIs, reducing data staleness to 500ms for accurate market-rate calculations across all trading pairs

**BarBuddy - Event-Based Food Ordering Platform** (TypeScript, NestJS, Prisma/PostgreSQL, Redis, Docker, Twilio, Google OAuth, JWT, Firebase FCM, Stripe)
- Delivered a food ordering backend serving 500+ concurrent events and 50k+ active users, integrating Stripe payments and an in-app wallet for split-payment transactions
- Implemented real-time order tracking with Firebase FCM push notifications, reducing order fulfillment time by 40%
- Optimized API performance with a Redis caching strategy, cutting database queries by 70% and achieving sub-200ms response times on critical endpoints

**IC-Poker - Real-Time Multiplayer Gaming Platform** (TypeScript, NestJS, PostgreSQL/Prisma, Redis, WebSockets, Docker, ICP Blockchain)
- Built a distributed poker game engine supporting 1,000+ concurrent cash games and tournaments with sub-100ms action latency using Redis-backed state management
- Developed tournament infrastructure (automated blind progression, table balancing, dynamic prize pools), hosting 200+ multi-table tournaments
- Built Redis-based distributed locking and atomic operations achieving zero race conditions across parallel game instances, with crash-recovery
- Scaled WebSocket communication to 10,000+ events/second for gameplay, in-game chat, and spectator dashboards with message deduplication
- Integrated ICP blockchain for wallet transactions and on-chain audit trails

## Independent Projects
<!-- None currently - all delivery work above is employer-attributed -->
None recorded yet.

## Technical Skills

### Backend & Languages
- **TypeScript / Node.js**: Express.js, NestJS

### Databases & Caching
- MongoDB, PostgreSQL, MySQL, Redis, Prisma, Sequelize

### Messaging & Queues
- Kafka, RabbitMQ, AWS SQS, BullMQ, AMQP

### Infrastructure
- AWS (IAM, EKS, EC2, S3, ELB, ASG), Docker, Kubernetes, Terraform

### Domain Expertise
- iGaming / real-money gaming platforms (casino, poker, tournaments)
- Payments and fintech (card rails, wallets, payment gateway integration, reconciliation)
- Real-time systems (WebSockets, Socket.io, pub/sub at scale)
- Crypto/blockchain-adjacent systems (swap engines, ICP blockchain integration)
- OLTP-to-OLAP analytics migration (ClickHouse)

### Observability & Tools
- Git, Swagger, Sentry, LogRocket, Datadog

### AI-First Development
- Agentic/AI-assisted development workflows using **Claude Code** and OpenAI Codex for backend feature delivery, refactoring, and test generation

## Publications
None.

## Awards
None recorded yet.

## References
None recorded yet - available upon request.
