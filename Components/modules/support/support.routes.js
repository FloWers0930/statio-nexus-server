// backend/src/modules/support/support.routes.js
// Support ticket routes

const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const { Authenticate, restrictTo } = require("../../middlewares/auth.js");
const { validateBody } = require("../../middlewares/validate.js");
const {
  getSupportTickets,
  createSupportTicket,
  replyToSupportTicket,
  getMyTickets,
  createSupportTicketSchema,
  replyToSupportTicketSchema,
} = require("./support.controller.js");

const router = express.Router();

const validateObjectId = (req, res, next) => {
  if (req.params.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid ID format" });
  }
  next();
};

// ✅ FIX 5: Rate limiter for ticket creation (prevent spam)
const ticketCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 tickets per hour per user
  message: {
    success: false,
    message:
      "Too many support tickets created. Please wait before creating another.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(Authenticate);

// Authenticated users — can create tickets and view their own
router.post(
  "/support/tickets",
  ticketCreationLimiter,
  validateBody(createSupportTicketSchema),
  createSupportTicket,
);
router.get("/support/my-tickets", getMyTickets);

// Admin-only support management — these routes require admin role
router.use(restrictTo("admin", "support"));
router.get("/support/tickets", getSupportTickets);
router.post(
  "/support/tickets/:id/reply",
  validateObjectId,
  validateBody(replyToSupportTicketSchema),
  replyToSupportTicket,
);

module.exports = router;
