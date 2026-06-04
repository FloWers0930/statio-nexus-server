// backend/src/modules/support/supportTicket.model.js
// Support ticket model

const mongoose = require("mongoose");

const replySchema = new mongoose.Schema({
  message: {
    type: String,
    required: [true, "Reply message is required"],
    trim: true,
  },
  repliedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  repliedByName: { type: String, required: true, trim: true },
  repliedAt: { type: Date, default: Date.now },
});

const supportTicketSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    category: {
      type: String,
      enum: ["booking", "payment", "technical", "account", "other"],
      default: "other",
    },
    status: {
      type: String,
      enum: ["open", "pending", "in-progress", "resolved"],
      default: "open",
      index: true,
    },
    replies: [replySchema],
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

supportTicketSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

supportTicketSchema.virtual("ticketNumber").get(function () {
  return `T-${this._id.toString().slice(-6).toUpperCase()}`;
});

supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ customer: 1, createdAt: -1 });
supportTicketSchema.index({ category: 1 });

const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);

module.exports = SupportTicket;
