# ⚡ Stripe Webhook Queue & Reliability Engine

[![CI Pipeline](https://github.com/Ali-Akbar-Git/stripe-webhook-queue/actions/workflows/ci.yml/badge.svg)](https://github.com/Ali-Akbar-Git/stripe-webhook-queue/actions)
![Node.js](https://img.shields.io/badge/Node.js-22.x-green?logo=node.js)
![Docker](https://img.shields.io/badge/Docker-Multi--Container-blue?logo=docker)
![Redis](https://img.shields.io/badge/Redis-Alpine-red?logo=redis)
![Testing](https://img.shields.io/badge/Testing-Jest%20%7C%20Supertest%20%7C%20Playwright-orange)

A fault-tolerant, cryptographically verified, and horizontally scalable webhook processing pipeline built with **Node.js, Express, SQLite, Redis, and BullMQ**.

Designed to eliminate standard webhook vulnerabilities: **duplicate deliveries (at-least-once semantics)**, **request timeouts under heavy load**, **signature tampering**, and **flaky testing infrastructure**.

---

## 🏛️ System Architecture

```text
                                [ Stripe API / External Webhook ]
                                                │
                                                ▼ (HTTP POST with stripe-signature)
                         ┌─────────────────────────────────────────────┐
                         │              EXPRESS INGRESS API            │
                         │  1. Capture Raw Bytes (req.rawBody)        │
                         │  2. HMAC SHA-256 Signature Verification     │
                         │  3. Runtime Zod Schema Validation           │
                         │  4. Fast-path Idempotency Check             │
                         │  5. Push Job to Redis Queue (<10ms)         │
                         └──────────────────────┬──────────────────────┘
                                                │
                                                ▼ (200 OK to Stripe immediately)
                                       ┌─────────────────┐
                                       │   REDIS QUEUE   │ (BullMQ)
                                       └────────┬────────┘
                                                │
                                                ▼ (Async Job Pull)
                         ┌─────────────────────────────────────────────┐
                         │          BACKGROUND WORKER PROCESS          │
                         │  1. Exponential Backoff Retries (1s, 2s, 4s)│
                         │  2. Atomic SQLite Database Persistence      │
                         │  3. Outbound Notification Dispatcher        │
                         │     (Discord / Slack / CRM with 4s Timeout) │
                         └─────────────────────────────────────────────┘
```

---

## ✨ Core Engineering Features

### 1. Ingestion Security & Defense-in-Depth

- **Raw Body Integrity:** Configured Express middleware to capture pristine byte buffers (`req.rawBody`) before parsing to prevent hash mismatch errors.
- **Cryptographic Verification:** Validates `stripe-signature` headers against timing attacks using constant-time buffer comparisons (`crypto.timingSafeEqual`) and timestamp replay protection.
- **Runtime Schema Safety:** Strict input validation via **Zod** (`StripeEventSchema` & `PaymentIntentSchema`) to prevent unhandled runtime exceptions from malformed third-party payloads.

### 2. High-Throughput Decoupling (Redis + BullMQ)

- **Sub-10ms Response Times:** Ingress endpoints offload business logic to an asynchronous Redis queue, preventing Stripe HTTP timeouts ($>3000\text{ms}$).
- **Exponential Backoff:** Configured automatic retries with backoff schedules ($1\text{s} \rightarrow 2\text{s} \rightarrow 4\text{s}$) to gracefully handle downstream database or network failures.
- **Queue-Level Deduplication:** Injected deterministic `jobId: event.id` into BullMQ to prevent duplicate concurrent queue jobs.

### 3. Database Idempotency Barrier

- **At-Least-Once Delivery Protection:** Implements an SQLite table (`processed_webhooks`) with unique primary keys to record processed `event_id` records, ensuring zero duplicate side-effects (e.g., duplicate charges or duplicate emails).

### 4. Resilient Outbound Dispatcher

- **Timeout Guards:** Outbound integrations (Discord/Slack/CRM) utilize `AbortSignal.timeout(4000)` to ensure third-party API downtime never hangs worker threads.

---

## 🧪 Testing Infrastructure

This repository includes a multi-layered testing suite ensuring high reliability across unit, integration, and E2E boundaries.

| Test Level           | Tooling              | What is Covered                                                                                                                                     |
| :------------------- | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API Integration**  | Jest + Supertest     | Forged signatures, missing headers, Zod schema violations, and duplicate event rejection.                                                           |
| **Async Pipeline**   | Jest + Worker Events | Deterministic testing of the full async flow (Webhook $\rightarrow$ Redis $\rightarrow$ Worker $\rightarrow$ SQLite) without flaky `sleep()` calls. |
| **End-to-End (E2E)** | Playwright           | Full checkout journey in a headless browser: form submission $\rightarrow$ webhook injection $\rightarrow$ live UI status update.                   |

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Persistence & Caching:** SQLite (`better-sqlite3`), Redis (`ioredis`)
- **Queue Orchestration:** BullMQ
- **Validation & Security:** Zod, Node Crypto (HMAC SHA-256)
- **Testing:** Jest, Supertest, Playwright
- **DevOps & CI/CD:** Docker, Docker Compose, GitHub Actions

---

## 🚀 Quickstart & Local Development

### Option A: Run via Docker Compose (Recommended)

Spin up the Redis broker, API server, and Worker in isolated containers with a single command:

```bash
# 1. Clone the repository
git clone https://github.com/Ali-Akbar-Git/stripe-webhook-queue.git
cd stripe-webhook-queue

# 2. Configure Environment Variables
cp .env.example .env

# 3. Start all services
docker compose up --build
```

The API will be available at `http://localhost:3000`.

---

### Option B: Run Natively for Development

#### 1. Prerequisites

- Node.js >= 20.x
- Local or Dockerized Redis running on port `6379`
- [Stripe CLI](https://docs.stripe.com/stripe-cli)

#### 2. Installation & Setup

```bash
npm install
```

#### 3. Start Background Worker & Server

```bash
# Terminal 1: Start Worker
node src/worker.js

# Terminal 2: Start API Server
node src/index.js
```

#### 4. Forward Live Stripe Events

```bash
# Terminal 3: Listen with Stripe CLI
stripe listen --forward-to localhost:3000/api/webhooks/payment-events
```

#### 5. Trigger a Mock Payment

```bash
# Terminal 4: Fire a test event
stripe trigger payment_intent.succeeded
```

---

## 🚥 Running Automated Tests

```bash
# Run Jest API & Async Pipeline Integration Tests
npm test

# Run Playwright End-to-End Browser Tests
npm run test:e2e

# Run Playwright in Visual UI Mode
npx playwright test --headed
```

---

## 🛡️ Edge Cases Handled

1. **Replay Attacks:** Webhooks older than 5 minutes are rejected using Stripe's cryptographically signed timestamp schema.
2. **Timing Attacks:** Signature verification execution times remain constant regardless of matching character counts.
3. **Downstream Service Outages:** If the notification webhook or database fails, the job remains in Redis and retries without dropping the message.
4. **Duplicate Webhook Delivery:** Returns `200 OK` with `{ status: 'already_processed' }` to stop upstream retries without re-running business logic.

---

## 👤 Author

- **Muhammad Ali Akbar / Backend Integration & Test Infrastructure Engineer**
- GitHub: [@Ali-Akbar-Git](https://github.com/Ali-Akbar-Git)

```

```
