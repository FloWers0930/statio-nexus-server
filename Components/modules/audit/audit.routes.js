// backend/src/modules/audit/audit.routes.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const { Authenticate, restrictTo } = require("../../middlewares/auth.js");
const { getAuditLog } = require("./audit.controller.js");

const router = express.Router();

// ✅ Rate limiter for heavy aggregation queries
const auditLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    message: "Too many audit log requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(Authenticate);

// Both admin and owner can access, but the controller handles the data scoping
router.get("/", restrictTo("admin", "owner"), auditLimiter, getAuditLog);

module.exports = router;
