// backend/src/modules/station/station.routes.js
const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const { Authenticate, restrictTo } = require("../../middlewares/auth.js");
const {
  getSpots,
  getSpot,
  createSpot,
  getTopPerformingLocations,
  createBooking,
  getMyBookings,
  completeBooking,
  cancelBooking,
} = require("./station.controller.js");

const router = express.Router();

// ── Rate limiter for booking creation ─────────────────────────────────────────
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many booking requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── ObjectId validation middleware ────────────────────────────────────────────
const validateObjectId = (req, res, next) => {
  if (req.params.id && !mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid ID format" });
  }
  next();
};

// ── Public routes (no auth required) ──────────────────────────────────────────
router.get("/spots", getSpots);
router.get("/spots/:id", validateObjectId, getSpot);

// ── Apply authentication to all routes below ──────────────────────────────────
router.use(Authenticate);

// ── Owner: Facility management ────────────────────────────────────────────────
router.post("/spots", restrictTo("owner"), createSpot);

// ── Admin & Owner: Analytics ──────────────────────────────────────────────────
router.get(
  "/top-performing",
  restrictTo("admin", "owner"),
  getTopPerformingLocations,
);

// ── User: Booking lifecycle ───────────────────────────────────────────────────
router.post("/bookings", bookingLimiter, restrictTo("user"), createBooking);
router.get("/my-bookings", restrictTo("user"), getMyBookings);
router.patch(
  "/bookings/:id/complete",
  validateObjectId,
  restrictTo("user"),
  completeBooking,
);
router.patch(
  "/bookings/:id/cancel",
  validateObjectId,
  restrictTo("user"),
  cancelBooking,
);

module.exports = router;
