// backend/src/modules/support/support.controller.js
// Support ticket controller

const { z } = require("../../middlewares/validate.js");
const SupportTicket = require("./supportTicket.model.js");
const emailService = require("../../config/email.js");
const logger = require("../../config/logger.js");

// ✅ Allowed values for validation
const VALID_CATEGORIES = [
  "billing",
  "technical",
  "account",
  "feature",
  "other",
];
const VALID_STATUSES = ["open", "pending", "resolved", "closed"];

const getSupportTickets = async (req, res, next) => {
  try {
    // Only allow admins or support staff to view all tickets
    if (req.user.role !== "admin" && req.user.role !== "support") {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view support tickets",
      });
    }

    // ✅ FIX 1: Add pagination with safe limits
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      SupportTicket.find()
        .populate("customer", "name email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      SupportTicket.countDocuments(),
    ]);

    res.json({
      success: true,
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

const createSupportTicketSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  category: z.enum(VALID_CATEGORIES).optional().default("other"),
});

const createSupportTicket = async (req, res, next) => {
  try {
    // ✅ FIX 2: Validate input with Zod
    const validated = createSupportTicketSchema.parse(req.body);
    const { title, description, category } = validated;

    const ticket = await SupportTicket.create({
      customer: req.user._id,
      title,
      description,
      category,
      status: "open",
    });

    await ticket.populate("customer", "name email");

    let emailSent = false;
    try {
      emailSent = await emailService.sendNewTicketNotification(ticket);
    } catch (emailErr) {
      logger.warn("Failed to send support ticket email", {
        ticketId: ticket._id,
        error: emailErr.message,
      });
      // Don't fail the ticket creation if email fails
    }

    const io = req.app.locals.io;
    if (io) io.emit("newSupportTicket", ticket);

    logger.info("✅ Support ticket created", {
      ticketId: ticket._id,
      customer: ticket.customer?.email,
      emailSent,
    });

    res.status(201).json({
      success: true,
      message: "Support ticket created successfully",
      ticket,
      emailSent,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors,
      });
    }
    next(error);
  }
};

const replyToSupportTicketSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  status: z.enum(VALID_STATUSES).optional(),
  sendEmail: z.coerce.boolean().optional().default(true),
});

const replyToSupportTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const validated = replyToSupportTicketSchema.parse(req.body);
    const { message, status, sendEmail } = validated;

    const ticket = await SupportTicket.findById(id).populate(
      "customer",
      "name email",
    );

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Support ticket not found" });
    }

    // ✅ FIX 3: Optional — prevent replies to closed tickets (business logic)
    if (ticket.status === "closed" && !status) {
      return res.status(400).json({
        success: false,
        message: "Cannot reply to a closed ticket. Reopen it first.",
      });
    }

    if (!ticket.replies) ticket.replies = [];
    ticket.replies.push({
      message: message.trim(),
      repliedBy: req.user._id,
      repliedByName: req.user.name || req.user.username || "Admin",
      repliedAt: new Date(),
    });

    if (status) ticket.status = status;
    ticket.lastUpdated = new Date();
    await ticket.save();

    let emailSent = false;
    if (sendEmail && ticket.customer?.email) {
      emailSent = await emailService.sendSupportReply(
        ticket.customer.email,
        ticket,
        message.trim(),
      );
    }

    logger.info("✅ Reply sent to ticket", {
      ticketId: ticket._id,
      repliedBy: req.user.id,
      emailSent,
    });

    const emitAuditLog = req.app.locals.emitAuditLog;
    if (emitAuditLog) {
      emitAuditLog({
        user: req.user.id,
        userName: req.user.name,
        userRole: req.user.role,
        action: "support_reply_sent",
        details: `Replied to ticket #${ticket._id.toString().slice(-6)}`,
        targetId: ticket._id,
        targetType: "support_ticket",
      });
    }

    res.json({
      success: true,
      message: "Reply sent successfully",
      ticket,
      emailSent,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors,
      });
    }
    logger.error("Error replying to ticket", { error: error.message });
    next(error);
  }
};

const getMyTickets = async (req, res, next) => {
  try {
    // ✅ FIX 4: Add pagination to user's own tickets too
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [tickets, total] = await Promise.all([
      SupportTicket.find({ customer: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("replies.repliedBy", "name username")
        .lean(),
      SupportTicket.countDocuments({ customer: req.user._id }),
    ]);

    res.json({
      success: true,
      tickets,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSupportTickets,
  createSupportTicket,
  replyToSupportTicket,
  getMyTickets,
  createSupportTicketSchema, // Export for routes
  replyToSupportTicketSchema,
};
