// backend/src/modules/analytics/analytics.routes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { Authenticate, restrictTo } = require("../../middlewares/auth.js");
const { getOwnerAnalytics } = require("./analytics.controller.js");

const router = express.Router();

// ✅ Rate limiter for heavy aggregation queries
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: {
    success: false,
    message: "Too many analytics requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ Middleware to set browser cache header (matches your backend 60s TTL)
const setCacheHeader = (req, res, next) => {
  res.set("Cache-Control", "private, max-age=60");
  next();
};

// Protect routes
router.use(Authenticate, restrictTo("owner", "admin"));

// Mount route with limiter and cache header
router.get("/", analyticsLimiter, setCacheHeader, getOwnerAnalytics);

module.exports = router;
