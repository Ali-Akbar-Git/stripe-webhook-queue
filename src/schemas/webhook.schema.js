// src/schemas/webhook.schema.js
const { z } = require('zod');

// Schema for Stripe PaymentIntent object inside event.data.object
const PaymentIntentSchema = z.object({
  id: z.string().startsWith('pi_'),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  customer: z.string().nullable().optional(),
  status: z.string(),
});

// Top-level Stripe Event Schema
const StripeEventSchema = z.object({
  id: z.string().startsWith('evt_'),
  type: z.string(),
  data: z.object({
    object: z.record(z.any()), // Raw object
  }),
});

module.exports = {
  StripeEventSchema,
  PaymentIntentSchema,
};