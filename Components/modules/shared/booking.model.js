// backend/src/modules/shared/booking.model.js
// Booking model - handles station reservations and payments

const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    spot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StationSpot",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded", "failed"],
      default: "pending",
      index: true,
    },
    vehicle: {
      plateNumber: {
        type: String,
        trim: true,
        uppercase: true,
        match: [/^[A-Z0-9-]+$/, "Invalid plate number format"],
      },
      vehicleType: {
        type: String,
        enum: ["car", "motorcycle", "truck", "van"],
      },
    },
    notes: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    cancelledAt: Date,
    cancellationReason: {
      type: String,
      maxlength: 500,
      trim: true,
    },
    completedAt: Date,
  },
  {
    timestamps: true,
  },
);

// ====================== INDEXES ======================
bookingSchema.index({ spot: 1, startTime: 1, endTime: 1 });
bookingSchema.index({ user: 1, status: 1 });
bookingSchema.index({ status: 1, paymentStatus: 1 });
bookingSchema.index({ spot: 1, status: 1 });

// ====================== PRE-SAVE MIDDLEWARE ======================
// Prevent overlapping bookings on the same station spot
bookingSchema.pre("save", async function (next) {
  // Skip validation if not a new booking or dates are not being modified
  if (
    !this.isNew &&
    !this.isModified("startTime") &&
    !this.isModified("endTime")
  ) {
    return next();
  }

  const overlap = await this.constructor.findOne({
    spot: this.spot,
    status: { $in: ["pending", "active"] },
    _id: { $ne: this._id },
    $or: [
      { startTime: { $lt: this.endTime }, endTime: { $gt: this.startTime } },
    ],
  });

  if (overlap) {
    return next(
      new Error("Station spot is already booked for this time period"),
    );
  }

  next();
});

const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;
