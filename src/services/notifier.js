// src/services/notifier.js

/**
 * Sends a payment notification to an external webhook (Discord, Slack, or CRM)
 * @param {Object} paymentData - The validated payment details
 */
async function sendPaymentAlert(paymentData) {
  // We can use a Discord Webhook URL or a mock URL (e.g., webhook.site)
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log(`⚠️  [Notifier] No DISCORD_WEBHOOK_URL set. Skipping outbound alert.`);
    return;
  }

  // 1. Transform internal data into the format required by Discord/Slack
  const payload = {
    content: `💰 **New Payment Received!**\n- **Amount:** $${paymentData.amount / 100} ${paymentData.currency.toUpperCase()}\n- **Customer:** ${paymentData.customer || 'Guest'}\n- **Payment Intent:** \`${paymentData.id}\``,
  };

  // 2. Make outbound HTTP request with a strict 4-second timeout
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(4000), // Protects worker from hanging longer than 4s
  });

  // 3. Handle non-2xx responses from external server
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Outbound Webhook failed with status ${response.status}: ${errorText}`);
  }

  console.log(` [Notifier] Outbound payment alert delivered successfully!`);
}

module.exports = { sendPaymentAlert };