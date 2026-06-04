// backend/src/modules/audit/audit.model.js
// Audit log model - tracks all important actions in the system

const mongoose = require("mongoose");

const auditSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    userRole: {
      type: String,
      required: true,
      // ✅ Added "support" and "manager" to match controller logic
      enum: ["admin", "owner", "user", "staff", "support", "manager"],
    },
    action: {
      type: String,
      required: true,
      enum: [
        "registered",
        "logged_in",
        "logged_out",
        "token_refreshed",
        "password_changed",
        "user_status_changed",
        "spot_created",
        "spot_updated",
        "spot_deleted",
        "booking_created",
        "booking_completed",
        "booking_updated",
        "booking_cancelled",
        "payment_processed",
        "system_config_changed",
        "settings_updated",
        "staff_created",
        "staff_updated",
        "staff_deleted",
        "support_reply_sent",
        "support_ticket_created", // ✅ Added for completeness
      ],
    },
    details: {
      type: String,
      required: true,
      trim: true,
    },
    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    isCritical: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// ── Immutability Guards ───────────────────────────────────────────────────────
// Centralized error function for blocked operations
const blockModification = function (next) {
  next(
    new Error("Audit records are immutable and cannot be modified or deleted"),
  );
};

// Block updates on existing documents
auditSchema.pre("save", function (next) {
  if (this.isNew) return next();
  next(new Error("Audit records are immutable and cannot be modified"));
});

// ✅ Block ALL update and delete methods
auditSchema.pre("findOneAndUpdate", blockModification);
auditSchema.pre("updateOne", blockModification);
auditSchema.pre("updateMany", blockModification);
auditSchema.pre("deleteOne", blockModification);
auditSchema.pre("deleteMany", blockModification);
auditSchema.pre("findOneAndDelete", blockModification);
auditSchema.pre("findOneAndReplace", blockModification);

// ── Indexes for fast queries ──────────────────────────────────────────────────
auditSchema.index({ createdAt: -1 });
auditSchema.index({ action: 1, createdAt: -1 });
auditSchema.index({ user: 1, createdAt: -1 });
// ✅ Compound index for faster critical log queries
auditSchema.index({ isCritical: 1, createdAt: -1 });

const Audit = mongoose.model("Audit", auditSchema);

module.exports = Audit;
