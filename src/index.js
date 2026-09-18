// index.js
require("dotenv").config();
const express = require("express");
const taskRoutes = require("./task");
require("./worker");

const app = express();
const webhookRoutes = require("./webhooks");
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
const path = require('path');

// Match the capitalized 'Public' folder in root directory
app.use(express.static(path.join(__dirname, '../Public')));

// Serve index.html on root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../Public/index.html'));
});
app.use("/api/tasks", taskRoutes);
app.use("/api/webhooks", webhookRoutes);

const PORT = process.env.PORT;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
