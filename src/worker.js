// src/worker.js
const { Worker } = require("bullmq");
const { connection } = require("./queue");
const db = require("./db");
const { sendPaymentAlert } = require("./services/notifier");

console.log("🚀 Webhook Background Worker started and listening for jobs...");

const worker = new Worker(
  "webhook-queue",
  async (job) => {
    const { eventId, eventType, data } = job.data;
    console.log(
      `\n[Worker] ⚙️ Processing Job ID ${job.id} | Event: ${eventType} (${eventId})`,
    );

    // Simulate business logic based on event type
    switch (eventType) {
      case "payment_intent.succeeded": {
        const paymentIntent = data.object;
        console.log(
          `[Worker] 💰 Fulfilling Order: $${paymentIntent.amount / 100} ${paymentIntent.currency.toUpperCase()}`,
        );

        // --- OUTBOUND INTEGRATION CALL ---
        await sendPaymentAlert({
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          customer: paymentIntent.customer,
        });

        break;
      }

      default:
        console.log(`[Worker] ℹ️ Handled event type: ${eventType}`);
    }

    // Record processed event in SQLite for audit history
    db.prepare(
      "INSERT OR IGNORE INTO processed_webhooks (event_id, event_type) VALUES (?, ?)",
    ).run(eventId, eventType);

    console.log(
      `[Worker]  Successfully completed job for Event ID: ${eventId}`,
    );
  },
  { connection },
);

// Worker lifecycle event listeners
worker.on("completed", (job) => {
  console.log(`[Worker Event] Job ${job.id} marked as COMPLETED.`);
});

worker.on("failed", (job, err) => {
  console.error(
    `[Worker Event] ❌ Job ${job.id} FAILED with error: ${err.message}. Retries remaining: ${job.opts.attempts - job.attemptsMade}`,
  );
});

module.exports = worker;
