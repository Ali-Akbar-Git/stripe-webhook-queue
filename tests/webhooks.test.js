// tests/webhooks.test.js
const request = require("supertest");
const Stripe = require("stripe");
const app = require("../src/index");
const db = require("../src/db");
const worker = require("../src/worker");

const stripe = new Stripe("sk_test_placeholder");
const TEST_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_secret";

describe("POST /api/webhooks/payment-events (Integration Tests)", () => {
  // Clean up test database before running tests
  beforeEach(() => {
    db.prepare("DELETE FROM processed_webhooks").run();
  });
  afterAll(async () => {
    await worker.close();
    db.close();
  });

  // Helper: Generates a real valid Stripe signature header for test payloads
  function generateStripeSignature(payloadString) {
    return stripe.webhooks.generateTestHeaderString({
      payload: payloadString,
      secret: TEST_WEBHOOK_SECRET,
    });
  }

  // --- TEST 1: Missing Signature Header ---
  it("should return 400 if stripe-signature header is missing", async () => {
    const payload = JSON.stringify({
      id: "evt_test_1",
      type: "payment_intent.succeeded",
    });

    const res = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.statusCode).toBe(400);
  });

  // --- TEST 2: Tampered/Invalid Signature ---
  it("should return 400 if signature is forged or tampered", async () => {
    const payload = JSON.stringify({
      id: "evt_test_2",
      type: "payment_intent.succeeded",
    });

    const res = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=12345,v1=fake_signature_hash")
      .send(payload);

    expect(res.statusCode).toBe(400);
  });

  // --- TEST 3: Malformed Payload (Fails Zod Schema) ---
  it("should return 400 if payload violates Zod schema (missing evt_ prefix)", async () => {
    // Bad ID (does not start with 'evt_')
    const badPayload = JSON.stringify({
      id: "invalid_id_without_prefix",
      type: "payment_intent.succeeded",
      data: { object: {} },
    });

    const signature = generateStripeSignature(badPayload);

    const res = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(badPayload);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Malformed Stripe event schema");
  });

  // --- TEST 4: Valid Payment Processing ---
  it("should successfully enqueue a valid payment_intent.succeeded event", async () => {
    const validPayload = JSON.stringify({
      id: "evt_valid_123",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test_abc123",
          amount: 5000,
          currency: "usd",
          status: "succeeded",
        },
      },
    });

    const signature = generateStripeSignature(validPayload);

    const res = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(validPayload);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("queued"); // Returns queued status immediately!

    // Wait 600ms for BullMQ worker to complete processing and insert to SQLite
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const row = db
      .prepare("SELECT * FROM processed_webhooks WHERE event_id = ?")
      .get("evt_valid_123");
    expect(row).toBeDefined();
    expect(row.event_id).toBe("evt_valid_123");
  });

  // --- TEST 5: Idempotency Protection ---
  it("should ignore duplicate events after initial processing completes", async () => {
    const duplicatePayload = JSON.stringify({
      id: "evt_duplicate_999",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_test_dup",
          amount: 2500,
          currency: "usd",
          status: "succeeded",
        },
      },
    });

    const signature = generateStripeSignature(duplicatePayload);

    // First request: Enqueued successfully
    const firstRes = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(duplicatePayload);

    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.body.status).toBe("queued");

    // Wait for Worker to finish writing to SQLite
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Second request (Duplicate): Blocked by SQLite Idempotency check
    const secondRes = await request(app)
      .post("/api/webhooks/payment-events")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(duplicatePayload);

    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.body.status).toBe("already_processed");
  });
});
