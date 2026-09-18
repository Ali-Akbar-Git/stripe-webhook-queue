// src/queue.js
const { Queue } = require('bullmq');

// Redis connection options matching your Docker container
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
};

// Create the webhook processing queue
const webhookQueue = new Queue('webhook-queue', {
  connection,
  defaultJobOptions: {
    attempts: 3, // Auto-retry failed jobs up to 3 times
    backoff: {
      type: 'exponential',
      delay: 1000, // 1s, 2s, 4s retry backoff
    },
    removeOnComplete: true, // Auto-cleanup completed jobs from Redis
    removeOnFail: false,    // Keep failed jobs in Redis for debugging/DLQ
  },
});

module.exports = {
  webhookQueue,
  connection,
};