// e2e/checkout-flow.spec.js
require('dotenv').config();
const { test, expect } = require('@playwright/test');
const Stripe = require('stripe');

const stripe = new Stripe('sk_test_placeholder');
const TEST_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';

test.describe("E2E SaaS Checkout & Webhook Pipeline", () => {
  test("User completes checkout -> Webhook arrives -> UI confirms success", async ({
    page,
    request,
  }) => {
    // 1. Visit the checkout page in a real browser
    await page.goto("/");

    // 2. Fill out checkout form
    await page.fill("#email", "customer@example.com");
    await page.click("#pay-button");

    // 3. Verify UI enters "Pending" state
    const statusBox = page.locator("#status-box");
    await expect(statusBox).toHaveText("⏳ Processing payment...");

    // 4. Simulate the Stripe Webhook arriving via APIRequestContext
    const eventId = `evt_e2e_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      id: eventId,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_e2e_mock",
          amount: 5000,
          currency: "usd",
          customer: "customer@example.com",
          status: "succeeded",
        },
      },
    });

    const signature = stripe.webhooks.generateTestHeaderString({
      payload: webhookPayload,
      secret: TEST_WEBHOOK_SECRET,
    });

    // Send the backend webhook directly from Playwright
    const response = await request.post("/api/webhooks/payment-events", {
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      data: webhookPayload,
    });

    // Print Express error details if it doesn't return 200
    if (response.status() !== 200) {
      console.log("--- BACKEND ERROR RESPONSE ---");
      console.log(await response.text());
      console.log("------------------------------");
    }

    expect(response.status()).toBe(200);

    // 5. Notify the frontend page that the payment succeeded (simulating real-time socket/event)
    await page.evaluate(() => {
      window.postMessage({ status: "PAID" }, "*");
    });

    // 6. Assert that the browser UI updates to "Payment Confirmed!"
    await expect(statusBox).toHaveText("✅ Payment Confirmed! Welcome to Pro.");
    await expect(statusBox).toHaveClass(/success/);
  });
});
