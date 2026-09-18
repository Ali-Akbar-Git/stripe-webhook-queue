// tests/pipeline.test.js
const request = require("supertest");
const Stripe = require("stripe");
const app = require("../src/index");
const db = require("../src/db");
const { webhookQueue } = require("../src/queue");
const worker = require("../src/worker");

const stripe = new Stripe("sk_test_placeholder");
const TEST_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_secret";

describe("End-to-End Async Webhook -> Worker Pipeline", () => {
  beforeEach(async () => {
    // 1. Clean SQLite database
    db.prepare("DELETE FROM processed_webhooks").run();
    // 2. Drain any leftover jobs in Redis
    await webhookQueue.drain();
  });

  afterAll(async () => {
    // Cleanly close queue and worker connections so Jest exits cleanly
    await worker.close();
    await webhookQueue.close();
  });

  // Helper function to sign payloads
  function generateStripeSignature(payloadString) {
    return stripe.webhooks.generateTestHeaderString({
      payload: payloadString,
      secret: TEST_WEBHOOK_SECRET,
    });
  }

  it("should receive webhook, enqueue job, and execute worker logic asynchronously", async () => {
    const eventId = `evt_async_test_${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_async_123",
          amount: 8500,
          currency: "usd",
          status: "succeeded",
        },
      },
    });

    const signature = generateStripeSignature(payload);

    // 1. Create a Promise that resolves WHEN the worker finishes processing this specific job
    const workerFinished = new Promise((resolve, reject) => {
      const handler = (job) => {
        if (job.data.eventId === eventId) {
          worker.off("completed", handler); // Clean up listener
          resolve(job);
        }
      };

      worker.on("completed", handler);

      // Failsafe timeout in case worker hangs
      setTimeout(
        () => reject(new Error("Worker timed out processing job")),
        5000,
      );
    });

    // 2. Send the HTTP request to Express
    const res = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);

    // 3. Verify HTTP response is immediate 200 OK
    expect(res.statusCode).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.status).toBe("queued");

    // 4. Await deterministic worker completion (NO random sleep timers!)
    const completedJob = await workerFinished;
    expect(completedJob.data.eventId).toBe(eventId);

    // 5. Verify the worker wrote the final state into SQLite
    const savedRecord = db
      .prepare("SELECT * FROM processed_webhooks WHERE event_id = ?")
      .get(eventId);

    expect(savedRecord).toBeDefined();
    expect(savedRecord.event_id).toBe(eventId);
    expect(savedRecord.event_type).toBe("payment_intent.succeeded");
  });
});
