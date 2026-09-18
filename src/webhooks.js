// src/webhooks.js
const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const db = require("./db");
const {
  StripeEventSchema,
  PaymentIntentSchema,
} = require("./schemas/webhook.schema");
const { webhookQueue } = require('./queue');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ENDPOINT_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
db.exec(`
  CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 2. Stripe Webhook Receiver
router.post("/payment-events", async (req, res) => {
  const signature = req.headers["stripe-signature"];

  let rawEvent;
  try {
    rawEvent = stripe.webhooks.constructEvent(
      req.rawBody,
      signature,
      ENDPOINT_SECRET,
    );
  } catch (err) {
    console.error(`⚠️  Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  const eventValidation = StripeEventSchema.safeParse(rawEvent);
  if (!eventValidation.success) {
    console.error(
      "❌ Malformed event structure:",
      eventValidation.error.format(),
    );
    return res.status(400).json({ error: "Malformed Stripe event schema" });
  }

  const event = eventValidation.data;

  // --- IDEMPOTENCY: Check if Stripe event ID already processed ---
  const existingEvent = db
    .prepare("SELECT event_id FROM processed_webhooks WHERE event_id = ?")
    .get(event.id);

  if (existingEvent) {
    console.log(
      `[Idempotency] Stripe Event ${event.id} already processed. Skipping.`,
    );
    return res
      .status(200)
      .json({ received: true, status: "already_processed" });
  }

  // --- BUSINESS LOGIC ---
  console.log(
    `[Stripe Webhook] Received Event Type: ${event.type} (ID: ${event.id})`,
  );

 // --- NEW: Asynchronous Queue Offload ---
  try {
    // BullMQ uses jobId for automatic queue-level deduplication
    await webhookQueue.add(
      'process-stripe-event',
      {
        eventId: event.id,
        eventType: event.type,
        data: event.data,
      },
      {
        jobId: event.id, // Prevents duplicate jobs from entering Redis simultaneously
      }
    );

    console.log(`⚡ [Webhook Ingress] Event ${event.id} enqueued to Redis in <10ms`);
  } catch (queueErr) {
    console.error('❌ Failed to enqueue webhook job:', queueErr.message);
    return res.status(500).json({ error: 'Failed to queue event' });
  }

  // Acknowledge Stripe immediately!
  return res.status(200).json({ received: true, status: 'queued' });
});

module.exports = router;
